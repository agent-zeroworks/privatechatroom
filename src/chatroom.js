// Minx's Chatroom — Durable Object
// Manages real-time room state: messages, connected users, broadcast.
// Private rooms only (v0.11.2 — the public room is gone): chats save
// forever and a room only opens to people who have the code. Closing is
// just leaving — the door stays. Rooms stamped with the old one-week
// deadline convert to permanent on first load.

import { ROOM_LIFETIME_MS, NOTIFY_DIGEST_WAIT_MS, NOTIFY_MIN_GAP_MS, NOTIFY_CODE_TTL_S } from './config.js'
import { sendEmail } from './email.js'

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

		// Connected WebSocket sessions: Map<webSocket, { username, role, baseRole, email }>
		this.sessions = new Map()
		// Members registry (private rooms only): email -> { nickname, firstSeen, origin }
		// Persisted, so the room knows who belongs even while everyone is away.
		this.members = null
		// Pending away-digests: email -> { count, lastSender, lastPreview, firstTs }
		// Persisted so a hibernated DO wakes to its own unread mail. The
		// min-gap clock (lastSentAt) lives on the MEMBER record instead —
		// digest entries die after flush, members persist.
		this.pendingDigests = null
		// Room metadata (private rooms): { created_at, expires_at } persisted
		// to storage. expires_at = null means the room never expires.
		this.meta = null
		// Message history (persisted to storage; keep last 100)
		this.messages = []
		this.loaded = false
	}

	// Load room metadata from storage.
	async loadMeta() {
		if (this.meta) return this.meta
		this.meta = (await this.state.storage.get('meta')) || null
		// v0.10.0 — real persistence: rooms never expire. Any room still
		// carrying the old one-week deadline converts to permanent the
		// first time it loads (history untouched).
		if (this.meta && this.meta.expires_at !== null && ROOM_LIFETIME_MS === null) {
			this.meta.expires_at = null
			await this.state.storage.put('meta', this.meta)
		}
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

	// Is this room past its expiry? With real persistence (v0.10.0) every
	// room converts to expires_at === null, so nothing is ever dormant.
	// Kept as a safety net for rolled-back or legacy state.
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
			// Stamp the room on first use. No expiry check — with real
			// persistence (v0.10.0) rooms never sleep; loadMeta already
			// converted any legacy deadline to null.
			await this.ensureMeta()

			const pair = new WebSocketPair()
			const [client, server] = Object.values(pair)

			// Parse the username from the URL
			let username = url.searchParams.get('username') || 'Anonymous'
			// Role rides along from the auth layer ('user' | 'agent'); it
			// comes from the session record, never from the client URL.
			const role = url.searchParams.get('role') || 'user'
			// v0.9.0 — identity for notifications. The email comes ONLY from
			// the auth layer (never from client input), and the origin is the
			// public URL of this worker so digest links point somewhere real.
			const email = (url.searchParams.get('email') || '').trim().toLowerCase()
			const origin = url.searchParams.get('origin') || ''
			// v0.8.3 — dev test tag, forwarded separately (dev-gated in
			// index.js). The tag overlays the base role; the base role is
			// remembered so a mid-room clear restores the account's true
			// role instead of the tagged one.
			const testTag = url.searchParams.get('tag') === 'agent' ? 'agent' : null
			const effectiveRole = testTag ? 'agent' : role

			// Accept the WebSocket
			server.accept()

			// Load persisted history once (DOs hibernate between requests)
			if (!this.loaded) {
				this.messages = (await this.state.storage.get('messages')) || []
				this.loaded = true
			}

			// Store the session
			this.sessions.set(server, { username, role: effectiveRole, baseRole: role, email })

			// v0.9.0 — remember the member. The first time an identity signs
			// into a room, the room learns they belong here; from then on,
			// messages while they're away become digest emails.
			if (email) {
				await this.loadMembers()
				if (!this.members.has(email)) {
					this.members.set(email, { nickname: username, firstSeen: Date.now(), origin })
					await this.state.storage.put('members', [...this.members.entries()])
				}
			}

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

					if (data.type === 'chat' && ((data.text && data.text.trim()) || (data.image && typeof data.image.url === 'string'))) {
						// Read the role from the live session record so a
						// mid-room tag flip (v0.8.3) shows on the next message.
						const sess = this.sessions.get(server)
						const msg = {
							type: 'chat',
							id: crypto.randomUUID(),
							sender: username,
							role: sess ? sess.role : effectiveRole,
							text: (data.text || '').trim(),
							ts: Date.now()
						}
						// v0.11.0 — photos. Only same-origin /img/ URLs minted by
						// /upload are accepted, so rooms can't smuggle arbitrary
						// links in (no tracking pixels, no external embeds).
						if (data.image && /^\/img\/[A-Za-z0-9-]+\.[a-z0-9]+$/.test(data.image.url)) {
							msg.image = { url: data.image.url, name: String(data.image.name || '').slice(0, 60) }
						}
						// An image that fails validation leaves nothing to show —
						// don't store an empty bubble.
						if (!msg.text && !msg.image) return

						// Store in history (persisted so it survives hibernation)
						this.messages.push(msg)

						if (this.messages.length > 100) {
							this.messages.shift()
						}
						await this.state.storage.put('messages', this.messages)
						// Broadcast to all
						this.broadcast(msg)
						// v0.9.0 — anyone who belongs here but isn't connected gets
						// queued for a digest email.
						await this.queueDigests(msg)
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
						// v0.10.0 — closing a room is just leaving. The room stays,
						// its chats stay saved, and anyone with the code can walk
						// back in later. Nothing ever wipes history now.
						this.sessions.delete(server)
						this.broadcastSystem(username + ' left')
						this.broadcastOnlineCount()
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

	// -----------------------------------------------------------------------
	// v0.9.0 — away-notifications (digest emails)
	// -----------------------------------------------------------------------

	async loadMembers() {
		if (this.members) return
		const raw = await this.state.storage.get('members')
		this.members = new Map(raw || [])
	}

	async loadDigests() {
		if (this.pendingDigests) return
		const raw = await this.state.storage.get('pendingDigests')
		this.pendingDigests = new Map(raw || [])
	}

	// Queue a digest entry for every member who isn't connected right now,
	// then make sure an alarm is standing by to flush it. Scarce by design:
	// one entry per recipient, count grows, email goes out once per window.
	async queueDigests(msg) {
		await this.loadMembers()
		await this.loadDigests()
		if (this.members.size === 0) return

		const connected = new Set()
		for (const [, s] of this.sessions) {
			if (s.email) connected.add(s.email)
		}

		const now = Date.now()
		let changed = false
		for (const [email, m] of this.members) {
			if (connected.has(email)) continue
			const d = this.pendingDigests.get(email) || { count: 0, lastSender: '', lastPreview: '', firstTs: 0 }
			d.count += 1
			d.lastSender = msg.sender
			// v0.11.0 — photo messages preview as [photo] so a caption-less
			// image still reads as something in the email.
			d.lastPreview = (msg.image ? '[photo] ' : '') + msg.text.slice(0, 120)
			if (!d.firstTs) d.firstTs = now
			this.pendingDigests.set(email, d)
			changed = true
		}

		if (!changed) return
		await this.state.storage.put('pendingDigests', [...this.pendingDigests.entries()])
		const existing = await this.state.storage.getAlarm()
		if (existing === null) {
			await this.state.storage.setAlarm(now + NOTIFY_DIGEST_WAIT_MS)
		}
	}

	// DO alarm — flush digests that are past their quiet window. Respects the
	// min-gap: an active room can't spam someone, it just holds the next
	// digest until the gap is up.
	async alarm() {
		await this.loadDigests()
		if (this.pendingDigests.size === 0) return

		const now = Date.now()
		for (const [email, d] of this.pendingDigests) {
			if (d.count === 0) continue
			const member = this.members.get(email)
			// Min-gap: the clock is the member's last email time. Undefined
			// (never emailed) reads as NaN → comparison false → sends.
			if (member && now - member.lastSentAt < NOTIFY_MIN_GAP_MS) continue
			await this.sendDigestEmail(email, d)
			if (member) {
				member.lastSentAt = now
			}
			d.count = 0
			d.lastSender = ''
			d.lastPreview = ''
			d.firstTs = 0
		}

		const still = [...this.pendingDigests.entries()].filter(([, d]) => d.count > 0)
		this.pendingDigests = new Map(still)
		await this.state.storage.put('pendingDigests', still)
		// Members changed (lastSentAt stamps) — persist.
		await this.state.storage.put('members', [...this.members.entries()])
		if (still.length > 0) {
			await this.state.storage.setAlarm(now + NOTIFY_MIN_GAP_MS)
		}
	}

	// Build + send one digest email. Honours the per-account pref (default
	// on). The one-tap link mints a fresh session, so the recipient lands
	// inside the room signed in — no code to type.
	async sendDigestEmail(email, d) {
		const pref = await this.env.ROOM_KV.get(`${this.env.APP_ENV}:notify:pref:${email}`)
		if (pref === '0') return

		const member = this.members.get(email) || {}
		const origin = member.origin || 'https://minx-chatroom.thegreateater0.workers.dev'
		const code = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
		await this.env.ROOM_KV.put(
			`${this.env.APP_ENV}:notify:${code}`,
			JSON.stringify({ email, room: this.roomCode, nickname: member.nickname || email, role: 'user' }),
			{ expirationTtl: NOTIFY_CODE_TTL_S }
		)

		const link = `${origin}/room/${this.roomCode}?n=${code}`
		const plural = d.count === 1 ? 'message' : 'messages'
		const subject = `💌 ${this.roomCode} — ${d.count} new ${plural} from ${d.lastSender}`
		const html = `<p><b>${d.lastSender}</b> said:</p><p style="padding:10px 14px;background:#f6f0e7;border-radius:8px;color:#333">${escapeHtml(d.lastPreview)}</p><p>${d.count} new ${plural} waiting in room <b>${this.roomCode}</b>.</p><p><a href="${link}" style="background:#c77b52;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open room</a></p><p style="color:#999;font-size:12px">One tap signs you in. You can turn these off in the sign-in panel.</p>`
		await sendEmail(this.env, { to: email, subject, html, kind: 'notify' })
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

// Tiny escape so message previews can't inject HTML into digest emails.
function escapeHtml(s) {
	return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Small JSON helper (module-scope so both the DO and future handlers use it).
function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json;charset=UTF-8' }
	})
}
