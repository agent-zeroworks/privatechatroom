// Minx's Chatroom — Cloudflare Worker
// Main focus: the public room (PUBLIC_ROOM code, never destroyed).
// Private rooms: every room is a Durable Object keyed by its 8-char code.
// Real persistence (v0.10.0): chats save forever, a room only opens to
// people with the code, and closing a room is just leaving.
//
// Auth (v0.3.0): magic-link login gates private rooms. Codes and sessions
// live in KV, keyed with the env name so dev and prod never collide.
// The test build has no email provider yet, so the magic link is shown
// inline on the sign-in screen instead of being emailed.

import { Chatroom } from './chatroom.js'
import { PUBLIC_ROOM, CODE_RE, SHOW_CODE_INLINE, DOOR_ENABLED, DOOR_CODES, DOOR_COOKIE, DOOR_COOKIE_VALUE, DOOR_MAX_ATTEMPTS, DOOR_WINDOW_S } from './config.js'
import { sendEmail } from './email.js'
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

		// DOOR (v0.8.0): both lanes are code-locked. Every request without the
		// door cookie gets sent to /door. Dev and prod have their own codes
		// (9119 test / 1221 official). Polite door, not a vault — it keeps
		// randoms from wandering into a preview.
		//
		// v0.8.1: every door response is no-store. A cached 302 to /door would
		// bounce even visitors holding a valid cookie — the "asks me for the
		// code again on every refresh" bug. No redirect here may ever be
		// cached by the edge or the browser.
		if (doorEnabled(env) && !doorUnlocked(request, env)) {
			if (path === '/health') {
				return new Response('ok', { status: 200 })
			}
			// Browsers get bounced to the door; API/WS callers get a flat 403.
			if (request.method === 'GET' || request.method === 'HEAD') {
				return new Response(null, {
					status: 302,
					headers: {
						'Location': new URL('/door', request.url).toString(),
						'Cache-Control': 'no-store, no-cache, must-revalidate'
					}
				})
			}
			return new Response('Locked', { status: 403, headers: { 'Cache-Control': 'no-store' } })
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
		// v0.9.0 — one-tap open from a notification email: trades the notify
		// link for a real session, then the frontend drops into the room.
		if (path === '/auth/notify-open' && request.method === 'POST') {
			return handleNotifyOpen(request, env)
		}
		// v0.9.0 — per-account notification pref (default on).
		if (path === '/notify/pref' && request.method === 'POST') {
			return handleNotifyPref(request, env)
		}
		// v0.11.0 — photo upload: signed-in members drop images into rooms.
		// Images live in KV (img:<env>:<name>) and are served back at /img/<name>.
		if (path === '/upload' && request.method === 'POST') {
			return handleUpload(request, env)
		}
		// v0.11.0 — serve a stored image. Same-origin <img> tags carry the
		// door cookie, so this stays behind the door like everything else.
		if (/^\/img\/[A-Za-z0-9-]+\.[a-z0-9]+$/.test(path) && request.method === 'GET') {
			return handleImage(request, env, path)
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
	// Every lane wears a ribbon: dev says TEST BUILD, official says COMING
	// SOON — the sign Joun asked for until Heartline actually launches.
	const banner = isDev
		? '<div id="test-banner"><span class="tb-mark">TEST BUILD</span><span id="test-banner-ver"></span><span class="tb-note">changes may break · not the real chatroom</span></div>'
		: '<div id="soon-banner"><span class="sb-mark">COMING SOON</span><span id="soon-banner-ver"></span><span class="sb-note">Heartline isn\'t ready for guests yet · preview build</span></div>'
	return new Response(FRONTEND.split('__APP_ENV_TAG__').join(tag).split('__BANNER__').join(banner), {
		headers: {
			'Content-Type': 'text/html;charset=UTF-8',
			// The page changes with every deploy — never let an edge cache
			// serve a stale build.
			'Cache-Control': 'no-store, no-cache, must-revalidate',
		}
	})
}

// ---------------------------------------------------------------------------
// DOOR — code lock for both lanes (v0.8.0)
// ---------------------------------------------------------------------------

function doorEnabled(env) {
	return DOOR_ENABLED[env.APP_ENV] === true
}

function doorCode(env) {
	return DOOR_CODES[env.APP_ENV] || null
}

// The door cookie is the key.
function doorUnlocked(request, env) {
	if (!doorEnabled(env)) return true
	const cookies = request.headers.get('Cookie') || ''
	return cookies.split(';').some(c => c.trim() === DOOR_COOKIE + '=' + DOOR_COOKIE_VALUE)
}

// The door page itself. Matches the app's light palette.
function serveDoor(env) {
	if (!doorEnabled(env)) {
		return new Response('Not found', { status: 404 })
	}
	const isDev = env.APP_ENV === 'dev'
	// Dev keeps the test-lane copy; official wears the coming-soon sign.
	return new Response(DOOR_HTML
		.split('__DOOR_TAG__').join(isDev ? 'Heartline · TEST BUILD' : 'Heartline · coming soon')
		.split('__DOOR_TITLE__').join(isDev ? 'Code locked' : 'Not ready yet')
		.split('__DOOR_COPY__').join(isDev
			? 'The test area is invite-only. Enter the door code to get in.'
			: 'Heartline is still under construction. If you have the door code, come in and look around. Otherwise: soon.')
		.split('__DOOR_FOOT__').join(isDev ? 'test build · not the real chatroom' : 'official build · preview only · coming soon')
	, {
		headers: {
			'Content-Type': 'text/html;charset=UTF-8',
			'Cache-Control': 'no-store, no-cache, must-revalidate',
		}
	})
}

// Validate the door code, mint the cookie, bounce to the app.
// Gentle brute-force guard: 5 failed tries per IP per minute via KV.
async function handleDoorUnlock(request, env) {
	if (!doorEnabled(env)) {
		return new Response('Not found', { status: 404 })
	}
	const ip = request.headers.get('CF-Connecting-IP') || 'anon'
	const failKey = kvKey(env, 'door:fail', ip)
	const fails = Number(await env.ROOM_KV.get(failKey)) || 0
	if (fails >= DOOR_MAX_ATTEMPTS) {
		return redirectNoStore('/door?e=2', request)
	}

	const form = await request.formData()
	const code = String(form.get('code') || '').trim()
	if (code === doorCode(env)) {
		await env.ROOM_KV.delete(failKey)
		return new Response(null, {
			status: 302,
			headers: {
				'Location': new URL('/', request.url).toString(),
				// 30-day door pass. Never cache the response that mints it.
				'Cache-Control': 'no-store, no-cache, must-revalidate',
				'Set-Cookie': DOOR_COOKIE + '=' + DOOR_COOKIE_VALUE + '; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=2592000'
			}
		})
	}

	await env.ROOM_KV.put(failKey, String(fails + 1), { expirationTtl: DOOR_WINDOW_S })
	return redirectNoStore('/door?e=1', request)
}

// A 302 that must never be cached (edge or browser). If a lock redirect
// gets cached, every refresh of the same URL bounces straight back to the
// door — even with a valid cookie — because the server never even sees the
// request. v0.8.1 makes that impossible.
function redirectNoStore(path, request) {
	return new Response(null, {
		status: 302,
		headers: {
			'Location': new URL(path, request.url).toString(),
			'Cache-Control': 'no-store, no-cache, must-revalidate'
		}
	})
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
    <div class="tag">__DOOR_TAG__</div>
    <h1>__DOOR_TITLE__</h1>
    <p>__DOOR_COPY__</p>
    <form method="post" action="/door/unlock" autocomplete="off">
      <input name="code" inputmode="numeric" maxlength="12" placeholder="Door code" autofocus>
      <button type="submit">Unlock</button>
      <p class="err" id="err"></p>
    </form>
    <div class="foot">__DOOR_FOOT__</div>
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
	// v0.9.0: the key's presence decides — if RESEND_API_KEY exists the link
	// is emailed; a failed send falls back to inline so login never bricks.
	const origin = new URL(request.url).origin
	const verifyLink = origin + '/auth/verify?code=' + code + '&email=' + encodeURIComponent(email)
	if (SHOW_CODE_INLINE && !env.RESEND_API_KEY) {
		return json({ ok: true, dev: true, devLink: verifyLink, devCode: code })
	}
	const sent = await sendEmail(env, {
		to: email,
		subject: 'Your Heartline sign-in code: ' + code,
		html: `<p>Your sign-in code is <b>${code}</b>.</p><p><a href="${verifyLink}">Open Heartline</a> (or enter the code on the sign-in screen).</p><p style="color:#999;font-size:12px">Code expires in 10 minutes.</p>`
	})
	if (!sent && SHOW_CODE_INLINE) {
		return json({ ok: true, dev: true, devLink: verifyLink, devCode: code })
	}
	return json({ ok: true, dev: false })
}

// TEST BUILD ONLY. Fixed identities per role so the developer can test the
// human and agent sides from two windows (normal + incognito). Mints a
// session directly — no magic code, no cooldown. Prod refuses outright:
// this endpoint exists to be a test convenience, never a backdoor.
//
// v0.8.3: the landing-page test buttons are pure tag toggles now (no
// session, no identity change), so nothing in the UI calls this endpoint
// anymore. Kept for future work — e.g. minting a full agent session when
// the agent VIEW needs testing again.
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

// v0.9.0 — the one-tap link from a notification email. The code is
// single-use and maps to { email, room }; trading it mints a real session
// exactly like the magic-link flow, so the recipient is signed in the
// moment the room page loads. No code to type, no email to enter.
async function handleNotifyOpen(request, env) {
	const body = await readBody(request)
	const code = String(body.code || '').trim()
	if (!code) {
		return json({ ok: false, error: 'Missing link' }, 400)
	}
	const raw = await env.ROOM_KV.get(kvKey(env, 'notify', code))
	if (!raw) {
		return json({ ok: false, error: 'Wrong or expired link' }, 401)
	}
	const rec = JSON.parse(raw)
	// Single use — burn it.
	await env.ROOM_KV.delete(kvKey(env, 'notify', code))

	const session = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
	const role = rec.role || 'user'
	await env.ROOM_KV.put(
		kvKey(env, 'session', session),
		JSON.stringify({ email: rec.email, nickname: rec.nickname || rec.email.split('@')[0], role }),
		{ expirationTtl: SESSION_TTL_S }
	)
	return json({ ok: true, session, email: rec.email, nickname: rec.nickname || rec.email.split('@')[0], role, room: rec.room })
}

// v0.9.0 — per-account notification pref. Stored without a TTL: a tiny
// key, and a lingering pref after an account dies is harmless.
async function handleNotifyPref(request, env) {
	const body = await readBody(request)
	const user = await sessionUser(env, body.token)
	if (!user) {
		return json({ ok: false }, 401)
	}
	const on = body.on === true
	await env.ROOM_KV.put(kvKey(env, 'notify:pref', user.email), on ? '1' : '0')
	return json({ ok: true, on })
}

async function handleAuthMe(request, env) {
	const token = new URL(request.url).searchParams.get('token')
	const user = await sessionUser(env, token)
	if (!user) {
		return json({ ok: false }, 401)
	}
	return json({ ok: true, email: user.email, nickname: user.nickname, role: user.role || 'user' })
}

// v0.11.0 — photo upload. Requires a real session (signed-in member), so
// the KV store can't be filled by randoms who happen to know the door code.
// 8 MB cap, image types only. The minted /img/ URL is what rooms carry.
const IMG_MAX_BYTES = 8 * 1024 * 1024
const IMG_TYPES = new Map([
	['image/jpeg', 'jpg'],
	['image/png', 'png'],
	['image/gif', 'gif'],
	['image/webp', 'webp']
])
const IMG_CT = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }

async function handleUpload(request, env) {
	const form = await request.formData().catch(() => null)
	if (!form) return json({ ok: false, error: 'Bad request' }, 400)

	const user = await sessionUser(env, String(form.get('token') || ''))
	if (!user) return json({ ok: false, error: 'Not signed in' }, 401)

	const file = form.get('image')
	if (!file || typeof file.arrayBuffer !== 'function') {
		return json({ ok: false, error: 'No image' }, 400)
	}
	const ct = String(file.type || '').toLowerCase()
	const ext = IMG_TYPES.get(ct)
	if (!ext) return json({ ok: false, error: 'Images only (jpg, png, gif, webp)' }, 415)

	const buf = await file.arrayBuffer()
	if (buf.byteLength === 0) return json({ ok: false, error: 'Empty file' }, 400)
	if (buf.byteLength > IMG_MAX_BYTES) return json({ ok: false, error: 'Too large (8 MB max)' }, 413)

	const name = crypto.randomUUID().replace(/-/g, '') + '.' + ext
	await env.ROOM_KV.put(kvKey(env, 'img', name), buf, { metadata: { ct } })
	return json({ ok: true, url: '/img/' + name })
}

async function handleImage(request, env, path) {
	const name = path.slice('/img/'.length)
	const hit = await env.ROOM_KV.getWithMetadata(kvKey(env, 'img', name), 'arrayBuffer')
	if (!hit || !hit.value) {
		return new Response('Not found', { status: 404 })
	}
	const ct = (hit.metadata && hit.metadata.ct) || IMG_CT[name.split('.').pop()] || 'application/octet-stream'
	return new Response(hit.value, {
		headers: { 'Content-Type': ct, 'Cache-Control': 'private, max-age=86400' }
	})
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

	// Identity: the public room stays anonymous for walk-ins (no token);
	// a signed-in account (e.g. a test account) brings its name and role
	// so the AGENT tag + view switcher work there too. Private rooms
	// require a valid session, and the account name IS the username —
	// no name spoofing behind a code.
	let username
	let role = 'user'
	let user = null
	if (room === PUBLIC_ROOM) {
		const token = url.searchParams.get('token')
		user = token ? await sessionUser(env, token) : null
		if (user) {
			username = user.nickname || user.email
			role = user.role || 'user'
		} else {
			username = url.searchParams.get('username') || 'Anonymous'
		}
	} else {
		user = await sessionUser(env, url.searchParams.get('token'))
		if (!user) {
			return new Response('Not signed in', { status: 401 })
		}
		username = user.nickname || user.email
		// The role comes from the session record, never from the client URL,
		// so nobody can self-assign 'agent' by editing a link.
		role = user.role || 'user'
	}

	// v0.8.3 — TEST TAG (dev only). The dev test buttons are pure tag
	// toggles: they change the display tag and nothing else. An explicit
	// tag=agent on the WS URL overrides the display role on the test
	// build only; the official build ignores the param entirely, so the
	// "no self-assigned agent tag" rule still holds in prod.
	// The tag is forwarded to the DO SEPARATELY from the role, so a
	// mid-room clear restores the account's true role (not the tagged one).
	let tagParam = ''
	if (env.APP_ENV === 'dev' && url.searchParams.get('tag') === 'agent') {
		tagParam = '&tag=agent'
	}

	// v0.9.0 — identity rides to the DO for notifications. Server-derived
	// only: the email comes from the session record, never the client. The
	// origin is this worker's public URL, so digest links point somewhere
	// reachable from the outside.
	let emailParam = ''
	if (user) {
		emailParam = '&email=' + encodeURIComponent(user.email)
	}
	const originParam = '&origin=' + encodeURIComponent(new URL(request.url).origin)

	const id = env.CHATROOM.idFromName('room-' + room)
	const stub = env.CHATROOM.get(id)

	// Forward to the Durable Object for WebSocket upgrade
	return await stub.fetch(
		new Request('http://internal/websocket?room=' + encodeURIComponent(room) + '&username=' + encodeURIComponent(username) + '&role=' + encodeURIComponent(role) + originParam + emailParam + tagParam, {
			headers: { 'Upgrade': 'websocket' }
		})
	)
}

// The Durable Object class must be exported from the entrypoint for the
// CHATROOM binding (wrangler.toml). Nothing else may be a named export.
export { Chatroom }
