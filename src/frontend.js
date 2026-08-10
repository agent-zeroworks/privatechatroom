// Minx's Chatroom — frontend
// Served as a single HTML page; the client routes between screens:
//   /             -> public room join (the main focus)
//   /private      -> private room landing (create / join by code, tucked aside)
//   /room/<code>  -> private room join
//   /auth/verify  -> magic-link landing (sign-in screen; dev shows link inline)
//
// NOTE: String.raw keeps backslashes intact, so regexes inside this HTML
// survive verbatim. Backticks and ${ are the only escapes needed — the
// client script uses neither. scripts/check-frontend.mjs verifies the
// extracted client script parses, so a broken page can never ship again.

export const FRONTEND = String.raw`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chatroom</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #f6f6f4;
    color: #333;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .screen {
    display: none;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 12px;
    padding: 20px;
    text-align: center;
  }
  .screen.on { display: flex; }

  .screen h1 { font-size: 1.5rem; font-weight: 600; color: #333; }
  .screen p { color: #777; max-width: 380px; line-height: 1.5; font-size: 0.9rem; }
  .screen .or { color: #999; font-size: 0.85rem; }

  .screen input {
    padding: 10px 12px;
    border-radius: 4px;
    border: 1px solid #ccc;
    background: #fff;
    color: #333;
    font-size: 0.95rem;
    width: 260px;
    outline: none;
  }
  .screen input:focus { border-color: #4a6fa5; }
  .screen input.code-input {
    width: 200px;
    text-transform: uppercase;
    letter-spacing: 1px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  .screen button {
    padding: 10px 24px;
    border-radius: 4px;
    border: 1px solid #4a6fa5;
    background: #4a6fa5;
    color: #fff;
    font-size: 0.95rem;
    cursor: pointer;
  }
  .screen button:hover { background: #3f5f8f; }
  .screen button:disabled { opacity: 0.5; cursor: not-allowed; }
  .screen button.ghost {
    background: #fff;
    color: #4a6fa5;
  }
  .screen button.ghost:hover { background: #eef2f7; }

  .row { display: flex; gap: 8px; align-items: center; }

  .foot-link {
    margin-top: 8px;
    background: none;
    border: none;
    padding: 0;
    color: #4a6fa5;
    font-size: 0.85rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .foot-link:hover { color: #3f5f8f; }

  .error {
    color: #b3261e;
    font-size: 0.8rem;
    min-height: 1.1em;
  }

  [hidden] { display: none !important; }

  /* Magic-link sign-in — the dev build shows the link inline (no email yet) */
  #auth-dev-box {
    background: #fff8e1;
    border: 1px dashed #b26a00;
    border-radius: 4px;
    padding: 10px 14px;
    max-width: 380px;
    font-size: 0.8rem;
    color: #5a3a00;
    word-break: break-all;
  }
  #auth-dev-box p { margin: 4px 0; }
  #auth-dev-box a { color: #4a6fa5; }
  #auth-dev-box b {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 1.2rem;
    letter-spacing: 3px;
    color: #333;
  }
  #auth-status {
    font-size: 0.8rem;
    color: #777;
    max-width: 380px;
    word-break: break-word;
  }

  #room-code-box {
    background: #fff;
    border: 1px solid #ccc;
    padding: 6px 12px;
    border-radius: 4px;
    color: #777;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  #room-code-box b {
    color: #333;
    letter-spacing: 2px;
    font-size: 1rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  #room-code-box button {
    background: #fff;
    border: 1px solid #ccc;
    color: #4a6fa5;
    padding: 3px 10px;
    font-size: 0.75rem;
    border-radius: 3px;
    cursor: pointer;
  }
  #room-code-box button:hover { background: #eef2f7; }

  #chat-screen { display: none; flex-direction: column; height: 100vh; }
  #chat-screen.on { display: flex; }

  #header {
    padding: 10px 16px;
    background: #fff;
    border-bottom: 1px solid #ddd;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  #header h2 { font-size: 1rem; font-weight: 600; color: #333; }
  #header span { font-size: 0.8rem; color: #777; }
  #header .head-actions { display: flex; gap: 8px; align-items: center; }
  #header button {
    padding: 6px 12px;
    font-size: 0.8rem;
    background: #fff;
    border: 1px solid #ccc;
    color: #555;
    border-radius: 4px;
    cursor: pointer;
  }
  #header button:hover { background: #f0f0f0; }
  #header button.leave:hover { background: #fdecea; border-color: #d32f2f; color: #d32f2f; }
  #header button.close:hover { background: #fdecea; border-color: #d32f2f; color: #d32f2f; }

  #status { font-size: 0.8rem; padding: 3px 10px; border-radius: 3px; border: 1px solid #ccc; }
  #status.connected { color: #2e7d32; border-color: #a5d6a7; background: #e8f5e9; }
  #status.disconnected { color: #c62828; border-color: #ef9a9a; background: #fdecea; }
  #status.connecting { color: #b26a00; border-color: #ffcc80; background: #fff3e0; }

  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .msg {
    padding: 8px 12px;
    border-radius: 4px;
    border: 1px solid #e0e0e0;
    background: #fff;
    max-width: 75%;
    word-wrap: break-word;
    line-height: 1.4;
    font-size: 0.92rem;
  }
  .msg .name { font-weight: 600; font-size: 0.78rem; margin-bottom: 2px; color: #555; }
  .msg .time { font-size: 0.7rem; color: #999; margin-top: 4px; }
  .msg.me {
    align-self: flex-end;
    background: #eaf1f8;
    border-color: #bcd0e4;
  }
  .msg.me .time { color: #7a93ad; }
  .msg.other { align-self: flex-start; }
  .msg.system {
    align-self: center;
    background: transparent;
    border: none;
    color: #999;
    font-size: 0.8rem;
  }
  .msg .del {
    margin-left: 8px;
    background: none;
    border: 1px solid #ccc;
    color: #888;
    border-radius: 3px;
    padding: 2px 8px;
    font-size: 0.7rem;
    cursor: pointer;
  }
  .msg .del:hover { background: #fdecea; border-color: #d32f2f; color: #d32f2f; }

  #input-area {
    display: flex;
    gap: 8px;
    padding: 10px 16px;
    background: #fff;
    border-top: 1px solid #ddd;
  }
  #input-area input {
    flex: 1;
    padding: 10px 12px;
    border-radius: 4px;
    border: 1px solid #ccc;
    background: #fff;
    color: #333;
    font-size: 0.95rem;
    outline: none;
  }
  #input-area input:focus { border-color: #4a6fa5; }
  #input-area button {
    padding: 10px 20px;
    border-radius: 4px;
    border: 1px solid #4a6fa5;
    background: #4a6fa5;
    color: #fff;
    font-weight: 500;
    cursor: pointer;
  }
  #input-area button:hover { background: #3f5f8f; }
  #input-area button:disabled { opacity: 0.4; cursor: not-allowed; }

  #online-count { font-size: 0.8rem; color: #777; }

  /* Heartline version badge — subtle, bottom-right, tap for history */
  #version-box {
    position: fixed;
    right: 10px;
    bottom: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.68rem;
    color: #b3b3b3;
    cursor: pointer;
    user-select: none;
    z-index: 50;
  }
  #version-box:hover { color: #777; }
  #version-history {
    position: absolute;
    right: 0;
    bottom: 20px;
    background: #fff;
    border: 1px solid #ddd;
    padding: 8px 10px;
    min-width: 230px;
    text-align: left;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.75rem;
    color: #555;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  #version-history[hidden] { display: none; }
  #version-history h3 {
    font-size: 0.68rem;
    font-weight: 600;
    color: #999;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 6px;
    border-bottom: 1px solid #f0f0f0;
    padding-bottom: 4px;
  }
  #version-history .vrow { padding: 4px 0; border-bottom: 1px solid #f5f5f5; }
  #version-history .vrow:last-child { border-bottom: none; }
  #version-history .vrow b {
    color: #333;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-weight: 600;
    font-size: 0.7rem;
  }
  #version-history .vrow span {
    display: block;
    color: #888;
    font-size: 0.7rem;
    line-height: 1.35;
    margin-top: 1px;
  }

  /* Test build banner — loud, fixed to the top. Only injected on the dev worker. */
  #test-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    background: repeating-linear-gradient(45deg, #ffb020, #ffb020 14px, #ffc94d 14px, #ffc94d 28px);
    color: #5a3a00;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.8rem;
    font-weight: 700;
    padding: 5px 10px;
    letter-spacing: 0.5px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }
  #test-banner .tb-mark {
    background: #5a3a00;
    color: #ffd98a;
    padding: 1px 8px;
    border-radius: 3px;
  }
  #test-banner .tb-note {
    font-weight: 400;
    opacity: 0.75;
  }
  /* Push content down so the banner never covers the header */
  body.test-build .screen, body.test-build #chat-screen { margin-top: 28px; }
</style>
</head>
<body>

<!-- TEST BUILD ribbon — injected by the worker only on the dev lane. -->
__TEST_BANNER__

<!-- PUBLIC ROOM — everyone lands here. -->
<div id="public-join" class="screen">
  <h1>Public room</h1>
  <p>Everyone lands here. No code needed.</p>
  <input id="public-name" type="text" placeholder="Your name" maxlength="24" autocomplete="off">
  <button id="public-join-btn">Join</button>
  <button class="foot-link" id="go-private">Private rooms</button>
</div>

<!-- PRIVATE ROOMS -->
<div id="private-landing" class="screen">
  <h1>Private rooms</h1>
  <p>Create a room and share the code. Only signed-in people with the code can join.</p>
  <div id="auth-status"></div>
  <button id="create-btn">Create a private room</button>
  <div class="or">or</div>
  <div class="row">
    <input id="code-input" class="code-input" type="text" placeholder="Enter a code" maxlength="8" autocomplete="off">
    <button id="join-code-btn">Join</button>
  </div>
  <div class="error" id="code-error"></div>
  <button class="foot-link" id="signout-btn">Sign out</button>
  <button class="foot-link" id="go-public">Public room</button>
</div>

<!-- PRIVATE ROOM JOIN -->
<div id="private-join" class="screen">
  <h1>Private room</h1>
  <div id="room-code-box">code <b id="room-code-display"></b><button id="copy-btn">Copy link</button></div>
  <p>Send the code or link to whoever you trust. This room is just for you.</p>
  <p id="join-identity"></p>
  <button id="private-join-btn">Join</button>
  <button class="foot-link" id="go-private-landing">Private rooms</button>
</div>

<!-- DORMANT ROOM — code past its week: locked, history kept, revival planned -->
<div id="dormant" class="screen">
  <h1>This room is asleep</h1>
  <div id="room-code-box">code <b id="dormant-code-display"></b></div>
  <p id="dormant-note">This room hit its one-week placeholder limit and went dormant. Its messages are tucked away safely, and the code stays reserved.</p>
  <p id="dormant-expiry" class="or"></p>
  <p>Revival is on the roadmap. When it ships, this room wakes up with everything intact.</p>
  <button class="ghost" id="dormant-private-btn">Private rooms</button>
  <button class="foot-link" id="dormant-public-btn">Public room</button>
</div>

<!-- SIGN IN — magic-link login. Gates private rooms. -->
<div id="signin" class="screen">
  <h1>Sign in</h1>
  <p>Private rooms are invite-only by code, and everyone inside is a signed-in account. One email, no passwords.</p>
  <input id="auth-email" type="email" placeholder="you@example.com" maxlength="120" autocomplete="email">
  <input id="auth-nick" type="text" placeholder="Nickname (optional)" maxlength="24" autocomplete="off">
  <button id="auth-request-btn">Send magic link</button>
  <div id="auth-dev-box" hidden>
    <p>TEST BUILD — no email service yet, so here is your link and code:</p>
    <a id="auth-dev-link" href="#"></a>
    <p>Code: <b id="auth-dev-code"></b></p>
  </div>
  <div class="row" id="auth-code-row" hidden>
    <input id="auth-code" class="code-input" type="text" placeholder="6-digit code" maxlength="6" inputmode="numeric" autocomplete="one-time-code">
    <button id="auth-verify-btn">Verify</button>
  </div>
  <div class="error" id="auth-error"></div>
  <button class="foot-link" id="auth-back">Public room</button>
</div>

<!-- CHAT -->
<div id="chat-screen">
  <div id="header">
    <div>
      <h2 id="room-title">Public room</h2>
      <span id="room-sub"></span>
    </div>
    <div class="head-actions">
      <span id="online-count">0 online</span>
      <button id="copy-header-btn" style="display:none">Copy link</button>
      <button id="close-room-btn" class="close" style="display:none">Close room</button>
      <button id="leave-btn" class="leave" style="display:none">Leave</button>
      <div id="status" class="disconnected">Disconnected</div>
    </div>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <input id="msg-input" type="text" placeholder="Type a message" maxlength="500" autocomplete="off" disabled>
    <button id="send-btn" disabled>Send</button>
  </div>
</div>

<!-- HEARTLINE VERSION — SemVer, bottom-right, tap for history -->
<div id="version-box">
  <span id="version-label">v0.2.2</span>
  <div id="version-history" hidden></div>
</div>

<script>
const PUBLIC_ROOM = 'CATCAFE8'
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Heartline versioning (SemVer): vMAJOR.MINOR.PATCH[-STAGE]
// Below v1.0.0 until the project is officially ready. Bump MINOR for new
// features, PATCH for fixes/improvements. Tell the developer on every bump.
const VERSION = 'v0.4.1'
const ENV_TAG = '__APP_ENV_TAG__'
const VERSION_HISTORY = [
  { v: 'v0.4.1', note: 'Lifecycle refined: during the week, private rooms keep the classic close-to-destroy (everyone closes → room deletes itself). Only rooms still alive at the week mark go dormant. Dormant rooms are reserved stock for future rentals' },
  { v: 'v0.4.0', note: 'Room lifecycle: private rooms live one week after first use, then the code goes dormant (locked, history kept). No more dying on close; config flip ready for real persistence' },
  { v: 'v0.3.0', note: 'Magic-link login: private rooms require a signed-in identity; test build shows the link on screen (no email provider yet)' },
  { v: 'v0.2.3', note: 'Test banner: loud TEST BUILD ribbon on the dev worker only; auto-gone in prod' },
  { v: 'v0.2.2', note: 'Dev/prod split: dev branch deploys to test worker, main is official; badge shows -dev on test builds' },
  { v: 'v0.2.1-dev', note: 'Version system: SemVer badge bottom-right, tap for history' },
  { v: 'v0.2.0-dev', note: 'Private rooms with codes, 24h message expiry, bare-bones UI' },
  { v: 'v0.1.0-dev', note: 'Initial prototype: public room chat' }
]

let ws = null
let username = ''
let roomCode = ''          // '' = public room
let isPrivate = false
let reconnectTimer = null
let leaving = false

// ---------- session (magic-link login) ----------

const SESSION_KEY = 'minx_session'
let session = null   // { token, email, nickname }

function saveSession(s) {
  session = s
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)) } catch (e) {}
}

function clearSession() {
  session = null
  try { localStorage.removeItem(SESSION_KEY) } catch (e) {}
}

function updateAuthUI() {
  const statusEl = document.getElementById('auth-status')
  if (statusEl) {
    statusEl.textContent = session
      ? 'Signed in as ' + session.nickname + ' (' + session.email + ')'
      : ''
  }
  const idEl = document.getElementById('join-identity')
  if (idEl) {
    idEl.textContent = session
      ? 'You will appear as ' + (session.nickname || session.email)
      : ''
  }
}

// Private rooms require a signed-in identity (enforced in route()).

async function requestLink() {
  const email = document.getElementById('auth-email').value.trim()
  const nick = document.getElementById('auth-nick').value.trim()
  const err = document.getElementById('auth-error')
  const btn = document.getElementById('auth-request-btn')
  err.textContent = ''
  if (!email) {
    err.textContent = 'Email first'
    document.getElementById('auth-email').focus()
    return
  }
  btn.disabled = true
  btn.textContent = 'Sending...'
  try {
    const res = await fetch('/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, nickname: nick })
    })
    const data = await res.json()
    if (!data.ok) {
      err.textContent = data.error || 'Something broke, try again'
      return
    }
    if (data.dev) {
      // TEST BUILD: no email yet — show the magic link inline.
      const linkEl = document.getElementById('auth-dev-link')
      linkEl.href = data.devLink
      linkEl.textContent = data.devLink
      document.getElementById('auth-dev-code').textContent = data.devCode
      document.getElementById('auth-dev-box').hidden = false
      document.getElementById('auth-code-row').hidden = false
      document.getElementById('auth-code').focus()
    }
  } catch (e) {
    err.textContent = 'Network hiccup, try again'
  } finally {
    btn.disabled = false
    btn.textContent = 'Send magic link'
  }
}

async function verifyCode() {
  const email = document.getElementById('auth-email').value.trim()
  const code = document.getElementById('auth-code').value.trim()
  const err = document.getElementById('auth-error')
  err.textContent = ''
  if (!code) {
    document.getElementById('auth-code').focus()
    return
  }
  const btn = document.getElementById('auth-verify-btn')
  btn.disabled = true
  try {
    const res = await fetch('/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, code: code })
    })
    const data = await res.json()
    if (!data.ok) {
      err.textContent = data.error || 'Wrong code'
      return
    }
    saveSession({ token: data.session, email: data.email, nickname: data.nickname })
    updateAuthUI()
    // Tapped magic link lands on /auth/verify — send them to the lounge.
    if (location.pathname === '/auth/verify') {
      location.href = '/private'
      return
    }
    route()
  } catch (e) {
    err.textContent = 'Network hiccup, try again'
  } finally {
    btn.disabled = false
  }
}

function signOut() {
  const token = session ? session.token : null
  clearSession()
  updateAuthUI()
  if (token) {
    fetch('/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session: token })
    }).catch(function () {})
  }
  route()
}

// ---------- routing ----------

function route() {
  // Magic link in the URL? Prefill and consume it (tapped dev link).
  const params = new URLSearchParams(location.search)
  if (params.get('code')) {
    document.getElementById('auth-email').value = params.get('email') || ''
    document.getElementById('auth-code').value = params.get('code')
    document.getElementById('auth-dev-box').hidden = false
    document.getElementById('auth-dev-link').textContent = 'Magic link received — hit Verify'
    document.getElementById('auth-dev-code').textContent = params.get('code')
    document.getElementById('auth-code-row').hidden = false
    history.replaceState({}, '', location.pathname)
  }

  const parts = location.pathname.split('/').filter(Boolean)
  const roomMatch = parts.length === 2 && parts[0] === 'room' && CODE_RE.test(parts[1])

  if (roomMatch && parts[1] !== PUBLIC_ROOM) {
    roomCode = parts[1]
    isPrivate = true
    document.getElementById('room-code-display').textContent = roomCode
    document.title = 'Room ' + roomCode
    show(session ? 'private-join' : 'signin')
    updateAuthUI()
    // A dormant code swaps this screen for the "room is asleep" one.
    checkRoomStatus(roomCode)
  } else if (location.pathname === '/private') {
    roomCode = ''
    isPrivate = false
    document.title = 'Private rooms'
    show(session ? 'private-landing' : 'signin')
    updateAuthUI()
  } else if (location.pathname === '/auth/verify') {
    roomCode = ''
    isPrivate = false
    document.title = 'Sign in'
    show('signin')
    updateAuthUI()
  } else {
    roomCode = ''
    isPrivate = false
    document.title = 'Chatroom'
    show('public-join')
  }
}

function show(id) {
  ['public-join', 'private-landing', 'private-join', 'dormant', 'signin', 'chat-screen'].forEach(function (s) {
    var el = document.getElementById(s)
    el.classList.toggle('on', s === id)
  })
}

// Ask the server whether a code is still awake. Dormant -> asleep screen.
async function checkRoomStatus(code) {
  try {
    const res = await fetch('/room/status?room=' + encodeURIComponent(code))
    if (!res.ok) return
    const data = await res.json()
    if (data.dormant) {
      document.getElementById('dormant-code-display').textContent = code
      const exp = document.getElementById('dormant-expiry')
      exp.textContent = data.expiresAt
        ? 'Went dormant ' + new Date(data.expiresAt).toLocaleDateString()
        : ''
      show('dormant')
    }
  } catch (e) {
    // Leave them on the join screen; the server rejects a dead room anyway.
  }
}

// ---------- landing actions ----------

function generateCode() {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return code
}

function createRoom() {
  location.href = '/room/' + generateCode()
}

function joinByCode() {
  const input = document.getElementById('code-input')
  const err = document.getElementById('code-error')
  const code = input.value.trim().toUpperCase()
  if (!CODE_RE.test(code)) {
    err.textContent = 'Codes are 8 characters: letters and numbers, no 0/O/1/I'
    input.focus()
    return
  }
  err.textContent = ''
  location.href = '/room/' + code
}

function copyText(text, done) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { legacyCopy(text, done) })
  } else {
    legacyCopy(text, done)
  }
}

function legacyCopy(text, done) {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
    done()
  } catch (e) {
    // give up silently — the code is still visible on screen
  }
  ta.remove()
}

function copyLink() {
  const btn = document.getElementById('copy-btn')
  const done = function () {
    btn.textContent = 'Copied'
    setTimeout(function () { btn.textContent = 'Copy link' }, 1500)
  }
  copyText(location.href, done)
}

function copyHeaderLink() {
  const btn = document.getElementById('copy-header-btn')
  const done = function () {
    btn.textContent = 'Copied'
    setTimeout(function () { btn.textContent = 'Copy link' }, 1500)
  }
  copyText(location.href, done)
}

// ---------- joining ----------

function joinPublic() {
  const input = document.getElementById('public-name')
  const name = input.value.trim()
  if (!name) return
  username = name
  enterChat()
}

function joinPrivate() {
  if (!session) {
    route()
    return
  }
  username = session.nickname || session.email
  enterChat()
}

function enterChat() {
  document.getElementById('room-title').textContent =
    isPrivate ? 'Room ' + roomCode : 'Public room'
  document.getElementById('room-sub').textContent =
    isPrivate ? 'Only people with the code can join' : 'Everyone lands here. No code needed.'

  document.getElementById('copy-header-btn').style.display = isPrivate ? '' : 'none'
  document.getElementById('close-room-btn').style.display = isPrivate ? '' : 'none'
  document.getElementById('leave-btn').style.display = isPrivate ? 'none' : ''

  show('chat-screen')
  connect()
}

// ---------- websocket ----------

function connect() {
  setStatus('connecting', 'Connecting...')
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const room = isPrivate ? roomCode : PUBLIC_ROOM
  let wsUrl = protocol + '//' + location.host + '/chat?room=' + room + '&username=' + encodeURIComponent(username)
  if (isPrivate && session) {
    wsUrl += '&token=' + encodeURIComponent(session.token)
  }
  ws = new WebSocket(wsUrl)

  ws.onopen = function () {
    setStatus('connected', 'Connected')
    document.getElementById('msg-input').disabled = false
    document.getElementById('send-btn').disabled = false
    document.getElementById('msg-input').focus()
  }

  ws.onclose = function () {
    setStatus('disconnected', 'Disconnected')
    document.getElementById('msg-input').disabled = true
    document.getElementById('send-btn').disabled = true
    if (leaving) return
    reconnectTimer = setTimeout(function () { connect() }, 3000)
  }

  ws.onerror = function () {
    ws.close()
  }

  ws.onmessage = function (event) {
    try {
      handleMessage(JSON.parse(event.data))
    } catch (e) {
      console.error('bad message', e)
    }
  }
}

function handleMessage(data) {
  switch (data.type) {
    case 'system':
      addMessage(null, data.text, 'system')
      break

    case 'chat':
      addMessage(data.sender, data.text, data.sender === username ? 'me' : 'other', data.id, data.ts)
      break

    case 'online_count':
      document.getElementById('online-count').textContent = data.count + ' online'
      break

    case 'history':
      data.messages.forEach(function (m) {
        addMessage(m.sender, m.text, m.sender === username ? 'me' : 'other', m.id, m.ts)
      })
      scrollToBottom()
      break

    case 'delete':
      const message = document.querySelector('[data-id="' + data.id + '"]')
      if (message) message.remove()
      break
  }
}

function addMessage(sender, text, type, id, ts) {
  const msgs = document.getElementById('messages')
  const div = document.createElement('div')
  div.className = 'msg ' + type
  if (type === 'system') {
    div.textContent = text
  } else {
    const time = new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    if (id) div.dataset.id = id

    const nameEl = document.createElement('div')
    nameEl.className = 'name'
    nameEl.textContent = sender
    div.appendChild(nameEl)
    div.appendChild(document.createTextNode(text))

    const timeEl = document.createElement('div')
    timeEl.className = 'time'
    timeEl.textContent = time
    div.appendChild(timeEl)

    if (type === 'me' && id) {
      const del = document.createElement('button')
      del.className = 'del'
      del.textContent = 'Delete'
      del.onclick = function () { deleteMessage(id) }
      div.appendChild(del)
    }
  }
  msgs.appendChild(div)
  scrollToBottom()
}

function scrollToBottom() {
  const msgs = document.getElementById('messages')
  msgs.scrollTop = msgs.scrollHeight
}

function sendMessage() {
  const input = document.getElementById('msg-input')
  const text = input.value.trim()
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'chat', text: text }))
  input.value = ''
  input.focus()
}

function deleteMessage(id) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify({ type: 'delete', id: id }))
}

// public room: just leave — the room lives on
function leaveRoom() {
  leaving = true
  if (ws && ws.readyState === WebSocket.OPEN) ws.close()
  ws = null
  clearTimeout(reconnectTimer)
  location.href = '/'
}

// private room: close it — during the placeholder week, when everyone's
// gone the room dies with the code. Survives to the week mark? It sleeps.
function closeRoom() {
  leaving = true
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'close' }))
  }
  ws = null
  clearTimeout(reconnectTimer)
  location.href = '/private'
}

function setStatus(state, label) {
  const el = document.getElementById('status')
  el.className = state
  el.textContent = label
}

// ---------- wire up ----------

document.getElementById('public-join-btn').addEventListener('click', joinPublic)
document.getElementById('private-join-btn').addEventListener('click', joinPrivate)
document.getElementById('create-btn').addEventListener('click', createRoom)
document.getElementById('join-code-btn').addEventListener('click', joinByCode)
document.getElementById('copy-btn').addEventListener('click', copyLink)
document.getElementById('copy-header-btn').addEventListener('click', copyHeaderLink)
document.getElementById('close-room-btn').addEventListener('click', closeRoom)
document.getElementById('leave-btn').addEventListener('click', leaveRoom)
document.getElementById('send-btn').addEventListener('click', sendMessage)
document.getElementById('go-private').addEventListener('click', function () { location.href = '/private' })
document.getElementById('go-public').addEventListener('click', function () { location.href = '/' })
document.getElementById('go-private-landing').addEventListener('click', function () { location.href = '/private' })
document.getElementById('dormant-private-btn').addEventListener('click', function () { location.href = '/private' })
document.getElementById('dormant-public-btn').addEventListener('click', function () { location.href = '/' })
document.getElementById('auth-request-btn').addEventListener('click', requestLink)
document.getElementById('auth-verify-btn').addEventListener('click', verifyCode)
document.getElementById('auth-back').addEventListener('click', function () { location.href = '/' })
document.getElementById('signout-btn').addEventListener('click', signOut)

document.getElementById('public-name').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') joinPublic()
})
document.getElementById('auth-email').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') requestLink()
})
document.getElementById('auth-code').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') verifyCode()
})
document.getElementById('msg-input').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') sendMessage()
})
document.getElementById('code-input').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') joinByCode()
})
document.getElementById('code-input').addEventListener('input', function () {
  document.getElementById('code-error').textContent = ''
})

// ---------- version badge ----------

const versionBox = document.getElementById('version-box')
const versionHistory = document.getElementById('version-history')

// Test banner version (only exists on the dev worker)
const testBannerVer = document.getElementById('test-banner-ver')
if (testBannerVer) {
  testBannerVer.textContent = VERSION + ENV_TAG
  document.body.classList.add('test-build')
}

document.getElementById('version-label').textContent = VERSION + ENV_TAG
VERSION_HISTORY.forEach(function (row) {
  const div = document.createElement('div')
  div.className = 'vrow'
  const b = document.createElement('b')
  b.textContent = row.v
  const span = document.createElement('span')
  span.textContent = row.note
  div.appendChild(b)
  div.appendChild(span)
  versionHistory.appendChild(div)
})

versionBox.addEventListener('click', function (e) {
  e.stopPropagation()
  versionHistory.hidden = !versionHistory.hidden
})
document.addEventListener('click', function () {
  versionHistory.hidden = true
})

// ---------- boot ----------

// Restore a saved session, validate it against the server, then route.
async function boot() {
  try {
    const saved = localStorage.getItem(SESSION_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
      if (parsed && parsed.token) {
        const res = await fetch('/auth/me?token=' + encodeURIComponent(parsed.token))
        if (res.ok) {
          const me = await res.json()
          session = { token: parsed.token, email: me.email, nickname: me.nickname }
        } else {
          localStorage.removeItem(SESSION_KEY)
        }
      }
    }
  } catch (e) {
    // Offline or KV lag — keep the saved session; the server will 401
    // if it's truly dead and the sign-in screen takes over.
  }
  updateAuthUI()
  route()
}

boot()
</script>
</body>
</html>`
