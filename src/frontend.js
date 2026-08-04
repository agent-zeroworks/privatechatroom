// Minx's Chatroom — frontend
// Served as a single HTML page; the client routes between screens:
//   /             -> public room join (the main focus)
//   /private      -> private room landing (create / join by code, tucked aside)
//   /room/<code>  -> private room join
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
<title>Minx's Chatroom 🐱</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
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
    gap: 14px;
    padding: 20px;
    text-align: center;
  }
  .screen.on { display: flex; }

  .screen h1 { font-size: 1.9rem; color: #c4a0ff; }
  .screen p { color: #888; max-width: 380px; line-height: 1.5; }
  .screen .or { color: #666; font-size: 0.85rem; }

  .screen input {
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid #333;
    background: #16213e;
    color: #e0e0e0;
    font-size: 1rem;
    width: 260px;
    outline: none;
  }
  .screen input:focus { border-color: #c4a0ff; }
  .screen input.code-input {
    width: 200px;
    text-transform: uppercase;
    letter-spacing: 2px;
  }

  .screen button {
    padding: 12px 32px;
    border-radius: 8px;
    border: none;
    background: #c4a0ff;
    color: #1a1a2e;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s;
  }
  .screen button:hover { background: #b388ff; }
  .screen button:disabled { opacity: 0.5; cursor: not-allowed; }
  .screen button.ghost {
    background: none;
    border: 1px solid #7a5ea8;
    color: #c4a0ff;
    font-weight: 500;
  }
  .screen button.ghost:hover { background: #7a5ea8; color: #1a1a2e; }

  .row { display: flex; gap: 8px; align-items: center; }

  .foot-link {
    margin-top: 8px;
    background: none;
    border: none;
    color: #7a5ea8;
    font-size: 0.85rem;
    cursor: pointer;
    text-decoration: underline;
  }
  .foot-link:hover { color: #c4a0ff; }

  .error {
    color: #ef9a9a;
    font-size: 0.8rem;
    min-height: 1.1em;
  }

  #room-code-pill {
    background: #16213e;
    border: 1px solid #333;
    padding: 8px 14px;
    border-radius: 20px;
    color: #888;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  #room-code-pill b { color: #c4a0ff; letter-spacing: 3px; font-size: 1.05rem; }
  #room-code-pill button {
    background: none;
    border: 1px solid #7a5ea8;
    color: #c4a0ff;
    padding: 4px 10px;
    font-size: 0.75rem;
    border-radius: 12px;
    cursor: pointer;
  }
  #room-code-pill button:hover { background: #7a5ea8; color: #1a1a2e; }

  #chat-screen { display: none; flex-direction: column; height: 100vh; }
  #chat-screen.on { display: flex; }

  #header {
    padding: 14px 20px;
    background: #16213e;
    border-bottom: 1px solid #333;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  #header h2 { font-size: 1.05rem; color: #c4a0ff; }
  #header span { font-size: 0.8rem; color: #888; }
  #header .head-actions { display: flex; gap: 8px; align-items: center; }
  #header button {
    padding: 8px 14px;
    font-size: 0.8rem;
    background: none;
    border: 1px solid #7a5ea8;
    color: #c4a0ff;
    border-radius: 8px;
    cursor: pointer;
  }
  #header button:hover { background: #b71c1c; border-color: #b71c1c; color: #fff; }
  #header button.leave:hover { background: #1b5e20; border-color: #1b5e20; color: #81c784; }

  #status { font-size: 0.8rem; padding: 4px 10px; border-radius: 12px; }
  #status.connected { background: #1b5e20; color: #81c784; }
  #status.disconnected { background: #b71c1c; color: #ef9a9a; }
  #status.connecting { background: #e65100; color: #ffcc80; }

  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .msg {
    padding: 10px 14px;
    border-radius: 12px;
    max-width: 75%;
    word-wrap: break-word;
    line-height: 1.4;
    font-size: 0.95rem;
  }
  .msg .name { font-weight: 600; font-size: 0.8rem; margin-bottom: 2px; }
  .msg .time { font-size: 0.7rem; color: #666; margin-top: 4px; }
  .msg.me {
    align-self: flex-end;
    background: #c4a0ff;
    color: #1a1a2e;
    border-bottom-right-radius: 4px;
  }
  .msg.me .time { color: #7a5ea8; }
  .msg.other {
    align-self: flex-start;
    background: #16213e;
    border-bottom-left-radius: 4px;
  }
  .msg.system {
    align-self: center;
    background: transparent;
    color: #666;
    font-size: 0.8rem;
    font-style: italic;
  }
  .msg .del {
    margin-left: 8px;
    background: none;
    border: 1px solid #7a5ea8;
    color: #7a5ea8;
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 0.7rem;
    cursor: pointer;
  }
  .msg .del:hover { background: #b71c1c; border-color: #b71c1c; color: #fff; }

  #input-area {
    display: flex;
    gap: 8px;
    padding: 14px 20px;
    background: #16213e;
    border-top: 1px solid #333;
  }
  #input-area input {
    flex: 1;
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid #333;
    background: #1a1a2e;
    color: #e0e0e0;
    font-size: 0.95rem;
    outline: none;
  }
  #input-area input:focus { border-color: #c4a0ff; }
  #input-area button {
    padding: 12px 20px;
    border-radius: 8px;
    border: none;
    background: #c4a0ff;
    color: #1a1a2e;
    font-weight: 600;
    cursor: pointer;
  }
  #input-area button:hover { background: #b388ff; }
  #input-area button:disabled { opacity: 0.4; cursor: not-allowed; }

  #online-count { font-size: 0.8rem; color: #888; }
</style>
</head>
<body>

<!-- PUBLIC ROOM — the main focus. Everyone lands here. -->
<div id="public-join" class="screen">
  <h1>🐱 public room</h1>
  <p>no code needed. walk in, say hi — this is the room everyone lands in.</p>
  <input id="public-name" type="text" placeholder="your name..." maxlength="24" autocomplete="off">
  <button id="public-join-btn">join the room</button>
  <button class="foot-link" id="go-private">want a private room? create one or enter a code →</button>
</div>

<!-- PRIVATE ROOMS — tucked to the side. -->
<div id="private-landing" class="screen">
  <h1>🔒 private rooms</h1>
  <p>your room, your walls. get a code, share it, nobody else gets in.</p>
  <button id="create-btn">create a private room</button>
  <div class="or">— or —</div>
  <div class="row">
    <input id="code-input" class="code-input" type="text" placeholder="enter a code" maxlength="8" autocomplete="off">
    <button id="join-code-btn">join</button>
  </div>
  <div class="error" id="code-error"></div>
  <button class="foot-link" id="go-public">← back to the public room</button>
</div>

<!-- PRIVATE ROOM JOIN -->
<div id="private-join" class="screen">
  <h1>🔒 private room</h1>
  <div id="room-code-pill">code <b id="room-code-display"></b><button id="copy-btn">copy link</button></div>
  <p>send the code or link to whoever you trust. this room is just for you.</p>
  <input id="private-name" type="text" placeholder="your name..." maxlength="24" autocomplete="off">
  <button id="private-join-btn">join</button>
  <button class="foot-link" id="go-private-landing">← to private rooms</button>
</div>

<!-- CHAT -->
<div id="chat-screen">
  <div id="header">
    <div>
      <h2 id="room-title">🐱 public room</h2>
      <span id="room-sub"></span>
    </div>
    <div class="head-actions">
      <span id="online-count">0 online</span>
      <button id="copy-header-btn" style="display:none">copy link</button>
      <button id="close-room-btn" style="display:none">close room</button>
      <button id="leave-btn" class="leave" style="display:none">leave</button>
      <div id="status" class="disconnected">disconnected</div>
    </div>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <input id="msg-input" type="text" placeholder="type something..." maxlength="500" autocomplete="off" disabled>
    <button id="send-btn" disabled>Send</button>
  </div>
</div>

<script>
const PUBLIC_ROOM = 'CATCAFE8'
const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

let ws = null
let username = ''
let roomCode = ''          // '' = public room
let isPrivate = false
let reconnectTimer = null
let leaving = false

// ---------- routing ----------

function route() {
  const parts = location.pathname.split('/').filter(Boolean)
  const roomMatch = parts.length === 2 && parts[0] === 'room' && CODE_RE.test(parts[1])

  if (roomMatch && parts[1] !== PUBLIC_ROOM) {
    roomCode = parts[1]
    isPrivate = true
    document.getElementById('room-code-display').textContent = roomCode
    document.title = 'room ' + roomCode + ' 🐱'
    show('private-join')
  } else if (location.pathname === '/private') {
    roomCode = ''
    isPrivate = false
    document.title = 'private rooms 🐱'
    show('private-landing')
  } else {
    roomCode = ''
    isPrivate = false
    document.title = 'Minx\'s chatroom 🐱'
    show('public-join')
  }
}

function show(id) {
  ['public-join', 'private-landing', 'private-join', 'chat-screen'].forEach(function (s) {
    var el = document.getElementById(s)
    el.classList.toggle('on', s === id)
  })
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
    err.textContent = 'codes are 8 characters — letters and numbers, no 0/O/1/I'
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
    btn.textContent = 'copied!'
    setTimeout(function () { btn.textContent = 'copy link' }, 1500)
  }
  copyText(location.href, done)
}

function copyHeaderLink() {
  const btn = document.getElementById('copy-header-btn')
  const done = function () {
    btn.textContent = 'copied!'
    setTimeout(function () { btn.textContent = 'copy link' }, 1500)
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
  const input = document.getElementById('private-name')
  const name = input.value.trim()
  if (!name) return
  username = name
  enterChat()
}

function enterChat() {
  document.getElementById('room-title').textContent =
    isPrivate ? '🔒 room ' + roomCode : '🐱 public room'
  document.getElementById('room-sub').textContent =
    isPrivate ? 'private — only people with the code get in' : 'everyone lands here · no code needed'

  document.getElementById('copy-header-btn').style.display = isPrivate ? '' : 'none'
  document.getElementById('close-room-btn').style.display = isPrivate ? '' : 'none'
  document.getElementById('leave-btn').style.display = isPrivate ? 'none' : ''

  show('chat-screen')
  connect()
}

// ---------- websocket ----------

function connect() {
  setStatus('connecting', 'connecting...')
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const room = isPrivate ? roomCode : PUBLIC_ROOM
  const wsUrl = protocol + '//' + location.host + '/chat?room=' + room + '&username=' + encodeURIComponent(username)
  ws = new WebSocket(wsUrl)

  ws.onopen = function () {
    setStatus('connected', 'connected')
    document.getElementById('msg-input').disabled = false
    document.getElementById('send-btn').disabled = false
    document.getElementById('msg-input').focus()
  }

  ws.onclose = function () {
    setStatus('disconnected', 'disconnected')
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
      addMessage(data.sender, data.text, data.sender === username ? 'me' : 'other', data.id)
      break

    case 'online_count':
      document.getElementById('online-count').textContent = data.count + ' online'
      break

    case 'history':
      data.messages.forEach(function (m) {
        addMessage(m.sender, m.text, m.sender === username ? 'me' : 'other', m.id)
      })
      scrollToBottom()
      break

    case 'delete':
      const message = document.querySelector('[data-id="' + data.id + '"]')
      if (message) message.remove()
      break
  }
}

function addMessage(sender, text, type, id) {
  const msgs = document.getElementById('messages')
  const div = document.createElement('div')
  div.className = 'msg ' + type
  if (type === 'system') {
    div.textContent = text
  } else {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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

// private room: close it — when everyone's gone, the room dies with the code
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

document.getElementById('public-name').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') joinPublic()
})
document.getElementById('private-name').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') joinPrivate()
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

route()
</script>
</body>
</html>`
