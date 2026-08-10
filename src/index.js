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
import { PUBLIC_ROOM, CODE_RE, SHOW_CODE_INLINE, DOOR_CODE, DOOR_COOKIE, DOOR_COOKIE_VALUE, DOOR_MAX_ATTEMPTS, DOOR_WINDOW_S } from './config.js'
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

		// Door routes first so they work whether or not the visitor is unlocked.
		// On prod these are plain 404s.
		if (path === '/door' && request.method === 'GET') {
			return serveDoor(env)
		}
		if (path === '/door/unlock' && request.method === 'POST') {
			return handleDoorUnlock(request, env)
		}

		// TEST-BUILD DOOR (v0.7.0): the dev worker is code-locked. Every
		// request without the door cookie gets sent to /door. Prod never
		// checks this — the official build stays open by design.
		if (env.APP_ENV === 'dev' && !doorUnlocked(request, env)) {
			if (path === '/health') {
				return new Response('ok', { status: 200 })
			}
			// Browsers get bounced to the door; API/WS callers get a flat 403.
			return request.method === 'GET' || request.method === 'HEAD'
				? Response.redirect(new URL('/door', request.url).toString(), 302)
				: new Response('Locked', { status: 403 })
		}

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
		// TEST BUILD ONLY: instant test accounts, one click, no email step.
		if (path === '/auth/dev-test' && request.method === 'POST') {
			return handleDevTest(request, env)
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
// TEST-BUILD DOOR — code lock for the dev worker (v0.7.0)
// ---------------------------------------------------------------------------

// The door cookie is the key. Prod never asks for it.
function doorUnlocked(request, env) {
	if (env.APP_ENV !== 'dev') return true
	const cookies = request.headers.get('Cookie') || ''
	return cookies.split(';').some(c => c.trim() === DOOR_COOKIE + '=' + DOOR_COOKIE_VALUE)
}

// The door page itself. Matches the app's light palette.
function serveDoor(env) {
	if (env.APP_ENV !== 'dev') {
		return new Response('Not found', { status: 404 })
	}
	return new Response(DOOR_HTML, {
		headers: {
			'Content-Type': 'text/html;charset=UTF-8',
			'Cache-Control': 'no-store, no-cache, must-revalidate',
		}
	})
}

// Validate the door code, mint the cookie, bounce to the app.
// Gentle brute-force guard: 5 failed tries per IP per minute via KV.
async function handleDoorUnlock(request, env) {
	if (env.APP_ENV !== 'dev') {
		return new Response('Not found', { status: 404 })
	}
	const ip = request.headers.get('CF-Connecting-IP') || 'anon'
	const failKey = kvKey(env, 'door:fail', ip)
	const fails = Number(await env.ROOM_KV.get(failKey)) || 0
	if (fails >= DOOR_MAX_ATTEMPTS) {
		return Response.redirect(new URL('/door?e=2', request.url).toString(), 302)
	}

	const form = await request.formData()
	const code = String(form.get('code') || '').trim()
	if (code === DOOR_CODE) {
		await env.ROOM_KV.delete(failKey)
		return new Response(null, {
			status: 302,
			headers: {
				'Location': new URL('/', request.url).toString(),
				'Set-Cookie': DOOR_COOKIE + '=' + DOOR_COOKIE_VALUE + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000'
			}
		})
	}

	await env.ROOM_KV.put(failKey, String(fails + 1), { expirationTtl: DOOR_WINDOW_S })
	return Response.redirect(new URL('/door?e=1', request.url).toString(), 302)
}

// ---------------------------------------------------------------------------
// Auth — magic-link login
// ---------------------------------------------------------------------------

// The door page. Plain string on purpose: no template-literal hazards,
// nothing to fetch, nothing to cache.
const DOOR_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Heartline · test build</title>
<style>
  :root { --bg:#f6f6f4; --panel:#ffffff; --fg:#333333; --sub:#777777; --border:#cccccc; --accent:#4a6fa5; --accent-hover:#3f5f8f; --danger:#b3261e; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:var(--bg); font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:var(--fg); }
  .card { background:var(--panel); border:1px solid var(--border); border-radius:14px; padding:36px 40px; width:340px; box-shadow:0 10px 30px rgba(0,0,0,0.06); }
  .tag { font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:var(--sub); margin-bottom:6px; }
  h1 { font-size:22px; margin:0 0 8px; }
  p { font-size:14px; color:var(--sub); margin:0 0 20px; line-height:1.5; }
  form { display:flex; flex-direction:column; gap:10px; }
  input { padding:11px 12px; font-size:16px; border:1px solid var(--border); border-radius:8px; letter-spacing:0.2em; text-align:center; }
  input:focus { outline:none; border-color:var(--accent); }
  button { padding:11px; font-size:15px; font-weight:600; background:var(--accent); color:#fff; border:none; border-radius:8px; cursor:pointer; }
  button:hover { background:var(--accent-hover); }
  .err { font-size:13px; color:var(--danger); margin:8px 0 0; min-height:18px; }
  .foot { font-size:11px; color:#aaaaaa; margin-top:18px; text-align:center; }
</style>
</head>
<body>
  <div class="card">
    <div class="tag">Heartline · TEST BUILD</div>
    <h1>Code locked</h1>
    <p>The test area is invite-only. Enter the door code to get in.</p>
    <form method="post" action="/door/unlock" autocomplete="off">
      <input name="code" inputmode="numeric" maxlength="12" placeholder="Door code" autofocus>
      <button type="submit">Unlock</button>
      <p class="err" id="err"></p>
    </form>
    <div class="foot">test build · not the real chatroom</div>
  </div>
  <script>
    var e = new URLSearchParams(location.search)
    if (e.get('e') === '1') document.getElementById('err').textContent = 'Wrong code, try again'
    if (e.get('e') === '2') document.getElementById('err').textContent = 'Too many tries. Wait a minute.'
  </script>
</body>
</html>`

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

	// Magic-link delivery: with SHOW_CODE_INLINE on (no email provider yet),
	// the link is returned inline and the frontend shows it on screen. The
	// day a provider is added, flip the flag and email the link instead.
	if (SHOW_CODE_INLINE) {
		const origin = new URL(request.url).origin
		const devLink = origin + '/auth/verify?code=' + code + '&email=' + encodeURIComponent(email)
		return json({ ok: true, dev: true, devLink, devCode: code })
	}
	return json({ ok: true, dev: false })
}

// TEST BUILD ONLY. Fixed identities per role so the developer can test the
// human and agent sides from two windows (normal + incognito). Mints a
// session directly — no magic code, no cooldown. Prod refuses outright:
// this endpoint exists to be a test convenience, never a backdoor.
const TEST_ACCOUNTS = {
	user:  { email: 'test.user@minx.dev',  nickname: 'Test User' },
	agent: { email: 'test.agent@minx.dev', nickname: 'Test Agent' }
}

async function handleDevTest(request, env) {
	if (env.APP_ENV !== 'dev') {
		return json({ ok: false, error: 'Not found' }, 404)
	}
	const body = await readBody(request)
	const role = body.role === 'agent' ? 'agent' : 'user'
	const account = TEST_ACCOUNTS[role]
	const session = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
	await env.ROOM_KV.put(
		kvKey(env, 'session', session),
		JSON.stringify({ email: account.email, nickname: account.nickname, role }),
		{ expirationTtl: SESSION_TTL_S }
	)
	return json({ ok: true, session, email: account.email, nickname: account.nickname, role })
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
	// Normal sign-ups are human accounts until the platform says otherwise.
	await env.ROOM_KV.put(
		kvKey(env, 'session', session),
		JSON.stringify({ email, nickname, role: 'user' }),
		{ expirationTtl: SESSION_TTL_S }
	)

	return json({ ok: true, session, email, nickname, role: 'user' })
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
	return json({ ok: true, email: user.email, nickname: user.nickname, role: user.role || 'user' })
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
	let role = 'user'
	if (room === PUBLIC_ROOM) {
		username = url.searchParams.get('username') || 'Anonymous'
	} else {
		const user = await sessionUser(env, url.searchParams.get('token'))
		if (!user) {
			return new Response('Not signed in', { status: 401 })
		}
		username = user.nickname || user.email
		// The role comes from the session record, never from the client URL,
		// so nobody can self-assign 'agent' by editing a link.
		role = user.role || 'user'
	}

	const id = env.CHATROOM.idFromName('room-' + room)
	const stub = env.CHATROOM.get(id)

	// Forward to the Durable Object for WebSocket upgrade
	return await stub.fetch(
		new Request('http://internal/websocket?room=' + encodeURIComponent(room) + '&username=' + encodeURIComponent(username) + '&role=' + encodeURIComponent(role), {
			headers: { 'Upgrade': 'websocket' }
		})
	)
}

// The Durable Object class must be exported from the entrypoint for the
// CHATROOM binding (wrangler.toml). Nothing else may be a named export.
export { Chatroom }
