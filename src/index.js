// Minx's Chatroom — Cloudflare Worker
// Main focus: the public room (PUBLIC_ROOM code, never destroyed).
// Private rooms: every room is a Durable Object keyed by its 8-char code.
// Placeholder policy: during the first week, a room deletes itself when
// everyone closes it (classic lifecycle). A room still alive after a week
// goes dormant (locked, history kept). The day real persistence ships, a
// config flip revives them.
//
// Auth (v0.3.0): magic-link login gates private rooms. Codes and sessions
// live in KV, keyed with the env name so dev and prod never collide.
// The test build has no email provider yet, so the magic link is shown
// inline on the sign-in screen instead of being emailed.

import { Chatroom } from './chatroom.js'
import { PUBLIC_ROOM, CODE_RE } from './config.js'
import { FRONTEND } from './frontend.js'

// Magic code: 6 digits, single use, 10 minutes.
const CODE_TTL_S = 10 * 60
// Sessions: 30 days.
const SESSION_TTL_S = 30 * 24 * 60 * 60
// Cooldown between codes for the same email (gentle spam guard).
const COOLDOWN_MS = 30 * 1000

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		const path = url.pathname

		// Auth endpoints (magic-link login)
		if (path === '/auth/request' && request.method === 'POST') {
			return handleAuthRequest(request, env)
		}
		if (path === '/auth/verify' && request.method === 'POST') {
			return handleAuthVerify(request, env)
		}
		if (path === '/auth/logout' && request.method === 'POST') {
			return handleAuthLogout(request, env)
		}
		if (path === '/auth/me') {
			return handleAuthMe(request, env)
		}

		// Frontend: public room (main focus), private room landing, a room
		// page, or the magic-link landing (GET on the verify path).
		if (path === '/' || path === '/index.html' || path === '/private' || path === '/auth/verify') {
			return serveFrontend(env)
		}

		if (/^\/room\/[A-HJ-NP-Z2-9]{8}$/.test(path)) {
			return serveFrontend(env)
		}

		// Room status — the frontend checks this before joining a private
		// room so a dormant code shows the right screen instead of a dead WS.
		if (path === '/room/status' && request.method === 'GET') {
			return handleRoomStatus(request, env)
		}

		// WebSocket connection to a room
		if (path === '/chat') {
			return handleWebSocket(request, env)
		}

		// Health check
		if (path === '/health') {
			return new Response('ok', { status: 200 })
		}

		return new Response('Not found', { status: 404 })
	}
}

function serveFrontend(env) {
	const isDev = env.APP_ENV === 'dev'
	// Dev worker tags the version badge with -dev so test builds are distinguishable.
	const tag = isDev ? '-dev' : ''
	// Test builds get a loud banner. Prod gets nothing — merge to main and it's gone.
	const banner = isDev
		? '<div id="test-banner"><span class="tb-mark">TEST BUILD</span><span id="test-banner-ver"></span><span class="tb-note">changes may break · not the real chatroom</span></div>'
		: ''
	return new Response(FRONTEND.split('__APP_ENV_TAG__').join(tag).split('__TEST_BANNER__').join(banner), {
		headers: {
			'Content-Type': 'text/html;charset=UTF-8',
			// The page changes with every deploy — never let an edge cache
			// serve a stale build.
			'Cache-Control': 'no-store, no-cache, must-revalidate',
		}
	})
}

// ---------------------------------------------------------------------------
// Auth — magic-link login
// ---------------------------------------------------------------------------

function json(data, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json;charset=UTF-8' }
	})
}

// Dev and prod share one KV namespace today; the env prefix keeps auth
// data from ever crossing lanes.
function kvKey(env, ...parts) {
	return [env.APP_ENV, ...parts].join(':')
}

function randomCode() {
	return String(Math.floor(100000 + Math.random() * 900000))
}

async function readBody(request) {
	try {
		return await request.json()
	} catch (e) {
		return {}
	}
}

// Look up a session token. Returns { email, nickname } or null.
async function sessionUser(env, token) {
	if (!token) return null
	try {
		const raw = await env.ROOM_KV.get(kvKey(env, 'session', token))
		return raw ? JSON.parse(raw) : null
	} catch (e) {
		return null
	}
}

// Step 1: ask for a magic link. Stores a 6-digit code (10 min, single use).
async function handleAuthRequest(request, env) {
	const body = await readBody(request)
	const email = String(body.email || '').trim().toLowerCase()
	if (!EMAIL_RE.test(email)) {
		return json({ ok: false, error: "That email doesn't look right" }, 400)
	}
	const nickname = String(body.nickname || '').trim().slice(0, 24)

	// Gentle cooldown so one email can't mint codes in a loop.
	const lastKey = kvKey(env, 'auth:last', email)
	const last = await env.ROOM_KV.get(lastKey)
	if (last && Date.now() - Number(last) < COOLDOWN_MS) {
		return json({ ok: false, error: 'Wait a few seconds between links' }, 429)
	}

	const code = randomCode()
	await env.ROOM_KV.put(
		kvKey(env, 'auth:code', code),
		JSON.stringify({ email, nickname }),
		{ expirationTtl: CODE_TTL_S }
	)
	await env.ROOM_KV.put(lastKey, String(Date.now()), { expirationTtl: 3600 })

	// TEST BUILD: no email provider yet, so the link is returned inline and
	// the frontend shows it on screen. The day a provider is added, this
	// branch emails the link instead of returning it.
	const isDev = env.APP_ENV === 'dev'
	if (isDev) {
		const origin = new URL(request.url).origin
		const devLink = origin + '/auth/verify?code=' + code + '&email=' + encodeURIComponent(email)
		return json({ ok: true, dev: true, devLink, devCode: code })
	}
	return json({ ok: true, dev: false })
}

// Step 2: trade the code for a session.
async function handleAuthVerify(request, env) {
	const body = await readBody(request)
	const email = String(body.email || '').trim().toLowerCase()
	const code = String(body.code || '').trim()
	if (!email || !code) {
		return json({ ok: false, error: 'Email and code are both needed' }, 400)
	}

	const raw = await env.ROOM_KV.get(kvKey(env, 'auth:code', code))
	if (!raw) {
		return json({ ok: false, error: 'Wrong or expired code' }, 401)
	}
	const rec = JSON.parse(raw)
	if (rec.email !== email) {
		return json({ ok: false, error: 'That code belongs to a different email' }, 401)
	}
	// Single use — burn the code.
	await env.ROOM_KV.delete(kvKey(env, 'auth:code', code))

	const session = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
	const nickname = rec.nickname || rec.email.split('@')[0]
	await env.ROOM_KV.put(
		kvKey(env, 'session', session),
		JSON.stringify({ email, nickname }),
		{ expirationTtl: SESSION_TTL_S }
	)

	return json({ ok: true, session, email, nickname })
}

async function handleAuthLogout(request, env) {
	const body = await readBody(request)
	if (body.session) {
		await env.ROOM_KV.delete(kvKey(env, 'session', String(body.session)))
	}
	return json({ ok: true })
}

async function handleAuthMe(request, env) {
	const token = new URL(request.url).searchParams.get('token')
	const user = await sessionUser(env, token)
	if (!user) {
		return json({ ok: false }, 401)
	}
	return json({ ok: true, email: user.email, nickname: user.nickname })
}

// Look up a room's lifecycle without opening a connection.
// exists:false  -> code never used; creating is still free
// dormant:true  -> code past its week; locked, history preserved
async function handleRoomStatus(request, env) {
	const room = (new URL(request.url).searchParams.get('room') || '').toUpperCase()
	if (!CODE_RE.test(room)) {
		return json({ error: 'Bad room code' }, 400)
	}
	if (room === PUBLIC_ROOM) {
		// The house never sleeps.
		return json({ exists: true, dormant: false, expiresAt: null })
	}
	const id = env.CHATROOM.idFromName('room-' + room)
	const stub = env.CHATROOM.get(id)
	return await stub.fetch(new Request('http://internal/status'))
}

// ---------------------------------------------------------------------------
// WebSocket
// ---------------------------------------------------------------------------

async function handleWebSocket(request, env) {
	const url = new URL(request.url)
	const room = (url.searchParams.get('room') || '').toUpperCase()

	// Every room is a Durable Object keyed by its code
	if (!CODE_RE.test(room)) {
		return new Response('Bad room code', { status: 400 })
	}

	// Identity: the public room stays anonymous-by-name; private rooms
	// require a valid session, and the account name IS the username —
	// no name spoofing behind a code.
	let username
	if (room === PUBLIC_ROOM) {
		username = url.searchParams.get('username') || 'Anonymous'
	} else {
		const user = await sessionUser(env, url.searchParams.get('token'))
		if (!user) {
			return new Response('Not signed in', { status: 401 })
		}
		username = user.nickname || user.email
	}

	const id = env.CHATROOM.idFromName('room-' + room)
	const stub = env.CHATROOM.get(id)

	// Forward to the Durable Object for WebSocket upgrade
	return await stub.fetch(
		new Request('http://internal/websocket?room=' + encodeURIComponent(room) + '&username=' + encodeURIComponent(username), {
			headers: { 'Upgrade': 'websocket' }
		})
	)
}

// The Durable Object class must be exported from the entrypoint for the
// CHATROOM binding (wrangler.toml). Nothing else may be a named export.
export { Chatroom }
