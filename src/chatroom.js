// Minx's Chatroom — Durable Object
// Manages real-time room state: messages, connected users, broadcast

export class Chatroom {
	constructor(state, env) {
		this.state = state
		this.env = env
		// Connected WebSocket sessions: Map<webSocket, { username: string }>
		this.sessions = new Map()
		// Users who explicitly closed the room
		this.closedBy = new Set()
		// Message history (persisted to storage; keep last 100)
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

			// Load persisted history once (DOs hibernate between requests)
			if (!this.loaded) {
				this.messages = (await this.state.storage.get('messages')) || []
				this.loaded = true
			}

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
							text: data.text.trim()
						}

						// Store in history (persisted so it survives hibernation)
						this.messages.push(msg)

						if (this.messages.length > 100) {
							this.messages.shift()
						}
						await this.state.storage.put('messages', this.messages)
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
						this.closedBy.add(username)
						this.broadcastSystem(username + ' closed the room')
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
				if (this.closedBy.has(username)) {
					// Already announced the explicit close
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

	// If everyone has closed the room, erase it — the code goes dead
	async maybeDestroy() {
		if (this.destroyed) return
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