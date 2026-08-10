// Minx's Chatroom — Durable Object
// Manages real-time room state: messages, connected users, broadcast.
// The public room (PUBLIC_ROOM) never dies; its history expires after 24h.
// Private rooms live ROOM_LIFETIME_MS after first use, then the code goes
// DORMANT: locked to new visitors, history preserved. No more dying on close.

import { PUBLIC_ROOM, ROOM_LIFETIME_MS, REVIVE_DORMANT } from './config.js'

// Public rooms forget messages older than 24 hours.
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000

export class Chatroom {
	constructor(state, env) {
		this.state = state
		this.env = env

		// Derive the room code from the DO's name (idFromName('room-' + code))
		// state.id.name is the documented way to get the name back; fall back
		// to toString() only if name is unavailable.
		const idObj = state.id
		const idName = idObj && idObj.name ? idObj.name : (idObj ? String(idObj) : '')
		this.roomCode = idName.replace(/^room-/, '')
		this.isPublic = this.roomCode === PUBLIC_ROOM

		// Connected WebSocket sessions: Map<webSocket, { username: string }>
		this.sessions = new Map()
		// Room metadata (private rooms): { created_at, expires_at } persisted
		// to storage. expires_at = null means the room never expires.
		this.meta = null
		// Message history (persisted to storage; keep last 100)
		// Public room: also pruned to the last 24 hours.
		this.messages = []
		this.loaded = false
	}

	// Load room metadata from storage (private rooms only).
	async loadMeta() {
		if (this.meta) return this.meta
		if (this.isPublic) {
			this.meta = {}
			return this.meta
		}
		this.meta = (await this.state.storage.get('meta')) || null
		return this.meta
	}

	// Create the room on first use: stamps created_at and expires_at.
	// The week starts when the code is first opened, not when it was minted.
	async ensureMeta() {
		const meta = await this.loadMeta()
		if (meta && meta.created_at) return meta
		const now = Date.now()
		const fresh = {
			created_at: now,
			expires_at: ROOM_LIFETIME_MS ? now + ROOM_LIFETIME_MS : null
		}
		this.meta = fresh
		await this.state.storage.put('meta', fresh)
		return fresh
	}

	// Is this room past its expiry? Public rooms and never-expiring rooms
	// (expires_at === null) are never dormant.
	async isDormant() {
		const meta = await this.loadMeta()
		if (!meta || !meta.expires_at) return false
		return Date.now() > meta.expires_at
	}

	// Handler for incoming requests to the DO
	async fetch(request) {
		const url = new URL(request.url)

		// Room status — lets the frontend show the dormant screen before
		// attempting a connection.
		if (url.pathname === '/status') {
			const meta = await this.loadMeta()
			if (!meta || !meta.created_at) {
				return json({ exists: false })
			}
			return json({
				exists: true,
				dormant: await this.isDormant(),
				createdAt: meta.created_at,
				expiresAt: meta.expires_at || null
			})
		}

		// WebSocket upgrade
		if (url.pathname === '/websocket') {
			// Private rooms: stamp the room on first use, then check expiry.
			// A dormant code is locked — the room sleeps, its history kept.
			if (!this.isPublic) {
				await this.ensureMeta()
				if (await this.isDormant()) {
					if (REVIVE_DORMANT) {
						// The day persistence ships: a visit wakes the room.
						this.meta.expires_at = ROOM_LIFETIME_MS ? Date.now() + ROOM_LIFETIME_MS : null
						await this.state.storage.put('meta', this.meta)
					} else {
						const meta = this.meta
						return json({
							error: 'dormant',
							code: this.roomCode,
							expiresAt: meta.expires_at
						}, 410)
					}
				}
			}

			const pair = new WebSocketPair()
			const [client, server] = Object.values(pair)

			// Parse the username from the URL
			let username = url.searchParams.get('username') || 'Anonymous'

			// Accept the WebSocket
			server.accept()

			// Load persisted history once (DOs hibernate between requests)
			if (!this.loaded) {
				this.messages = (await this.state.storage.get('messages')) || []
				this.loaded = true
			}

			// Public room: forget anything older than 24 hours
			await this.pruneExpired()

			// Store the session
			this.sessions.set(server, { username })

			// Send chat history to the new user
			server.send(JSON.stringify({
				type: 'history',
				messages: this.messages
			}))

			// Broadcast join
			this.broadcastSystem(username + ' joined')

			// Update online count
			this.broadcastOnlineCount()

			// Set up message handler
			server.addEventListener('message', async (event) => {
				try {
					const data = JSON.parse(event.data)

					if (data.type === 'chat' && data.text && data.text.trim()) {
						const msg = {
							type: 'chat',
							id: crypto.randomUUID(),
							sender: username,
							text: data.text.trim(),
							ts: Date.now()
						}

						// Store in history (persisted so it survives hibernation)
						this.messages.push(msg)

						if (this.messages.length > 100) {
							this.messages.shift()
						}
						await this.state.storage.put('messages', this.messages)
						// Public room: drop anything that just turned 24h old
						await this.pruneExpired()
						// Broadcast to all
						this.broadcast(msg)
					}

					if (data.type === 'delete' && data.id) {
						const message = this.messages.find(
							msg => msg.id === data.id
						)

						if (message && message.sender === username) {
							this.messages = this.messages.filter(
								msg => msg.id !== data.id
							)

							await this.state.storage.put('messages', this.messages)

							this.broadcast({
								type: 'delete',
								id: data.id
							})
						}
					}

					if (data.type === 'close') {
						// Closing is just leaving now — the room itself lives on
						// until its week is up. The code stays joinable.
						this.sessions.delete(server)
						server.close()
					}
				} catch (e) {
					// Ignore bad messages
				}
			})

			// Handle disconnect (explicit close fires this too)
			server.addEventListener('close', () => {
				this.sessions.delete(server)
				this.broadcastSystem(username + ' left')
				this.broadcastOnlineCount()
			})

			return new Response(null, { status: 101, webSocket: client })
		}

		return new Response('Not found', { status: 404 })
	}

	// Public rooms forget everything older than 24 hours. Old messages
	// without a timestamp (pre-2026-08-09) count as expired.
	async pruneExpired() {
		if (!this.isPublic || this.messages.length === 0) return
		const cutoff = Date.now() - HISTORY_TTL_MS
		const kept = this.messages.filter(m => typeof m.ts === 'number' && m.ts >= cutoff)
		if (kept.length === this.messages.length) return
		this.messages = kept
		if (kept.length === 0) {
			await this.state.storage.delete('messages')
		} else {
			await this.state.storage.put('messages', kept)
		}
	}

	// Rooms never die by closing anymore. Private rooms sleep (dormant) a
	// week after creation; public rooms are the house and never go away.

	// Broadcast a message to all connected sessions
	broadcast(data) {
		const msg = JSON.stringify(data)
		for (const [ws] of this.sessions) {
			try {
				ws.send(msg)
			} catch (e) {
				// Remove dead connections
				this.sessions.delete(ws)
			}
		}
	}

	// Broadcast a system message (join/leave notifications)
	broadcastSystem(text) {
		this.broadcast({ type: 'system', text })
	}

	// Broadcast the current online count
	broadcastOnlineCount() {
		this.broadcast({
			type: 'online_count',
			count: this.sessions.size
		})
	}
}

// Small JSON helper (module-scope so both the DO and future handlers use it).
function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json;charset=UTF-8' }
	})
}
