// Minx's Chatroom — Durable Object
// Manages real-time room state: messages, connected users, broadcast

export class Chatroom {
	constructor(state, env) {
		this.state = state
		this.env = env
		// Connected WebSocket sessions: Map<webSocket, { username: string }>
		this.sessions = new Map()
		// Message history (in-memory — resets if DO hibernates; keep last 100)
		this.messages = []
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

						// Store in history
						this.messages.push(msg)

						if (this.messages.length > 100) {
							this.messages.shift()
						}
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

							this.broadcast({
								type: 'delete',
								id: data.id
							})
						}
					}
				} catch (e) {
					// Ignore bad messages
				}
			})

			// Handle disconnect
			server.addEventListener('close', () => {
				this.sessions.delete(server)
				this.broadcastSystem(username + ' left')
				this.broadcastOnlineCount()
			})

			return new Response(null, { status: 101, webSocket: client })
		}

		return new Response('Not found', { status: 404 })
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