// Minx's Chatroom — Durable Object
// Manages real-time room state: messages, connected users, broadcast.
// The public room (PUBLIC_ROOM) never dies; its history expires after 24h.
// Private rooms die when every party has explicitly closed them.

import { PUBLIC_ROOM } from './config.js'

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
		// Message history (persisted to storage; keep last 100)
		// Public room: also pruned to the last 24 hours.
		this.messages = []
		this.loaded = false
		this.destroyed = false
	}

	// Handler for incoming requests to the DO
	async fetch(request) {
		const url = new URL(request.url)

		// WebSocket upgrade
		if (url.pathname === '/websocket') {
			const pair = new WebSocketPair()
			const [client, server] = Object.values(pair)

			// Parse the username from the URL
			let username = url.searchParams.get('username') || 'Anonymous'

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
						// User closed the room on their side
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

	// If everyone has closed the room, erase it — the code goes dead.
	// The public room is exempt: it is the house, it never goes away.
	async maybeDestroy() {
		if (this.destroyed) return
		if (this.isPublic) return
		if (this.sessions.size > 0) return
		if (this.closedBy.size === 0) return

		this.destroyed = true
		await this.state.storage.deleteAll()
		this.messages = []
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
