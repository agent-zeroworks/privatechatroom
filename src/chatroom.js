// Minx's Chatroom — Durable Object
// Manages real-time room state: messages, connected users, broadcast.
// The public room (PUBLIC_ROOM) never dies; its history expires after 24h.
// Private rooms (PLACEHOLDER POLICY): during their first week they keep the
// classic lifecycle — when every party closes the room, it deletes itself.
// A room still alive ROOM_LIFETIME_MS after first use goes DORMANT: locked
// to new visitors, history preserved, code reserved (the future rental pool).

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
		// Sockets that explicitly closed the room (private rooms only)
		this.closedBy = new Set()
		// Room metadata (private rooms): { created_at, expires_at } persisted
		// to storage. expires_at = null means the room never expires.
		this.meta = null
		// Message history (persisted to storage; keep last 100)
		// Public room: also pruned to the last 24 hours.
		this.messages = []
		this.loaded = false
		this.destroyed = false
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
			// Role rides along from the auth layer ('user' | 'agent'); the
			// public room never sends one, so it defaults to user.
			const role = url.searchParams.get('role') || 'user'
			// v0.8.3 — dev test tag, forwarded separately (dev-gated in
			// index.js). The tag overlays the base role; the base role is
			// remembered so a mid-room clear restores the account's true
			// role instead of the tagged one.
			const testTag = url.searchParams.get('tag') === 'agent' ? 'agent' : null
			const effectiveRole = testTag ? 'agent' : role

			// Accept the WebSocket
			server.accept()

			// A new connection resurrects the room — a code can be used again
			// after everyone closed it, and it must be destroyable again too.
			this.destroyed = false

			// Load persisted history once (DOs hibernate between requests)
			if (!this.loaded) {
				this.messages = (await this.state.storage.get('messages')) || []
				this.loaded = true
			}

			// Public room: forget anything older than 24 hours
			await this.pruneExpired()

			// Store the session
			this.sessions.set(server, { username, role: effectiveRole, baseRole: role })

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
						// Read the role from the live session record so a
						// mid-room tag flip (v0.8.3) shows on the next message.
						const sess = this.sessions.get(server)
						const msg = {
							type: 'chat',
							id: crypto.randomUUID(),
							sender: username,
							role: sess ? sess.role : effectiveRole,
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

					// v0.8.3 — dev-only test tag: flip your display tag live.
					// Honored only on the test build; prod ignores the message.
					// 'agent' sets the tag, anything else restores the role the
					// connection opened with BEFORE the tag (the account's true
					// role — tracked separately as baseRole).
					if (data.type === 'tag' && this.env.APP_ENV === 'dev') {
						const sess = this.sessions.get(server)
						if (!sess) return
						sess.role = data.tag === 'agent' ? 'agent' : sess.baseRole
						server.send(JSON.stringify({ type: 'tag_ack', role: sess.role }))
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
						// User closed the room on their side. During the placeholder
						// week this is the old classic lifecycle: a private room
						// deletes itself once every party has closed it.
						this.sessions.delete(server)
						if (this.isPublic) {
							// Public room: closing is just leaving — the room lives on
							this.broadcastSystem(username + ' left')
						} else {
							this.closedBy.add(server)
							this.broadcastSystem(username + ' closed the room')
						}
						this.broadcastOnlineCount()
						server.close()
						await this.maybeDestroy()
					}
				} catch (e) {
					// Ignore bad messages
				}
			})

			// Handle disconnect (explicit close fires this too)
			server.addEventListener('close', () => {
				this.sessions.delete(server)
				if (this.closedBy.has(server)) {
					this.closedBy.delete(server)
					this.maybeDestroy()
					return
				}
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

	// If everyone has closed the room during its placeholder week, erase it —
	// the code goes dead (a fresh visit starts a brand-new room). The public
	// room is exempt: it is the house, it never goes away. A DORMANT room is
	// exempt too: its history is preserved on purpose, it's reserved stock
	// for the future rental model — sleeping rooms are never wiped.
	async maybeDestroy() {
		if (this.destroyed) return
		if (this.isPublic) return
		if (this.sessions.size > 0) return
		if (this.closedBy.size === 0) return
		if (await this.isDormant()) return

		this.destroyed = true
		await this.state.storage.deleteAll()
		this.messages = []
		// Drop the cached meta too: a revisit on this same instance must see a
		// wiped room and stamp a fresh week, not a stale (possibly dormant) one.
		this.meta = null
	}

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
