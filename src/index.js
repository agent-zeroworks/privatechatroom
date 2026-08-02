// Minx's Chatroom — Cloudflare Worker
// Single-room chat with real-time messaging via Durable Objects

import { Chatroom } from './chatroom.js'

// The single room ID — one room, always the same
const ROOM_ID = 'minx-main-room'

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		const path = url.pathname

		// Serve the frontend
		if (path === '/' || path === '/index.html') {
			return serveFrontend()
		}

		// WebSocket connection to the chatroom
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

async function serveFrontend() {
	// In production, you'd serve from a static asset bucket
	// For simplicity, we embed the HTML in the Worker and serve it directly
	const html = `<!DOCTYPE html>
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

  #join-screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    gap: 16px;
    padding: 20px;
  }
  #join-screen h1 { font-size: 2rem; color: #c4a0ff; }
  #join-screen p { color: #888; text-align: center; max-width: 400px; line-height: 1.5; }
  #join-screen input {
    padding: 12px 16px;
    border-radius: 8px;
    border: 1px solid #333;
    background: #16213e;
    color: #e0e0e0;
    font-size: 1rem;
    width: 280px;
    outline: none;
  }
  #join-screen input:focus { border-color: #c4a0ff; }
  #join-screen button {
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
  #join-screen button:hover { background: #b388ff; }
  #join-screen button:disabled { opacity: 0.5; cursor: not-allowed; }

  #chat-screen { display: none; flex-direction: column; height: 100vh; }

  #header {
    padding: 16px 20px;
    background: #16213e;
    border-bottom: 1px solid #333;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  #header h2 { font-size: 1.1rem; color: #c4a0ff; }
  #header span { font-size: 0.85rem; color: #888; }
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
  .msg .name {
    font-weight: 600;
    font-size: 0.8rem;
    margin-bottom: 2px;
  }
  .msg .time {
    font-size: 0.7rem;
    color: #666;
    margin-top: 4px;
  }
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

  #input-area {
    display: flex;
    gap: 8px;
    padding: 16px 20px;
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
    transition: background 0.2s;
  }
  #input-area button:hover { background: #b388ff; }
  #input-area button:disabled { opacity: 0.4; cursor: not-allowed; }

  #online-count {
    font-size: 0.8rem;
    color: #888;
  }
</style>
</head>
<body>
<div id="join-screen">
  <h1>🐱 Minx's Chatroom</h1>
  <p>a cozy corner of the internet — say hi, share something, or just vibe</p>
  <input id="username-input" type="text" placeholder="your name..." maxlength="24" autocomplete="off">
  <button id="join-btn" onclick="joinChat()">Join</button>
</div>

<div id="chat-screen">
  <div id="header">
    <div>
      <h2>🐱 Minx's Chatroom</h2>
      <span id="online-count">0 online</span>
    </div>
    <div id="status" class="disconnected">disconnected</div>
  </div>
  <div id="messages"></div>
  <div id="input-area">
    <input id="msg-input" type="text" placeholder="type something..." maxlength="500" autocomplete="off" disabled>
    <button id="send-btn" onclick="sendMessage()" disabled>Send</button>
  </div>
</div>

<script>
let ws = null
let username = ''
let reconnectTimer = null

function joinChat() {
  const input = document.getElementById('username-input')
  const name = input.value.trim()
  if (!name) return
  username = name
  document.getElementById('join-screen').style.display = 'none'
  document.getElementById('chat-screen').style.display = 'flex'
  connect()
}

function connect() {
  setStatus('connecting', 'connecting...')
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const wsUrl = protocol + '//' + location.host + '/chat?username=' + encodeURIComponent(username)
  ws = new WebSocket(wsUrl)

  ws.onopen = () => {
    setStatus('connected', 'connected')
    document.getElementById('msg-input').disabled = false
    document.getElementById('send-btn').disabled = false
    document.getElementById('msg-input').focus()
  }

  ws.onclose = () => {
    setStatus('disconnected', 'disconnected')
    document.getElementById('msg-input').disabled = true
    document.getElementById('send-btn').disabled = true
    // Auto-reconnect after 3 seconds
    reconnectTimer = setTimeout(() => connect(), 3000)
  }

  ws.onerror = () => {
    ws.close()
  }

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      handleMessage(data)
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
      const isMe = data.sender === username
      addMessage(
        data.sender,
        data.text,
        isMe ? 'me' : 'other',
        data.id
      )
      break

    case 'online_count':
      document.getElementById('online-count').textContent = data.count + ' online'
      break

    case 'history':
      data.messages.forEach(m => {
        const isMe = m.sender === username
        addMessage(
          m.sender,
          m.text,
          isMe ? 'me' : 'other',
          m.id
        )
      })

      const msgs = document.getElementById('messages')
      msgs.scrollTop = msgs.scrollHeight
      break

    case 'delete':
      const message = document.querySelector(
        '[data-id="' + data.id + '"]'
      )

      if (message) {
        message.remove()
      }
      break
  }
}

function addMessage(sender, text, type, id = null) {
  const msgs = document.getElementById('messages')
  const div = document.createElement('div')
  div.className = 'msg ' + type
  if (type === 'system') {
    div.textContent = text
  } else {
    const time = new Date().toLocaleTimeString([], { 
      hour: '2-digit', 
      minute: '2-digit' 
    })

    div.dataset.id = id

    div.innerHTML =
      '<div class="name">' + escapeHtml(sender) + '</div>' +
      escapeHtml(text) +
      '<div class="time">' + time + '</div>'

  if (type === 'me' && id) {
    const deleteBtn = document.createElement('button')
    deleteBtn.textContent = 'Delete'
    deleteBtn.style.cssText = 'margin-left: 8px; background: none; border: 1px solid #7a5ea8; color: #7a5ea8; border-radius: 4px; padding: 2px 8px; font-size: 0.7rem; cursor: pointer;'
    deleteBtn.onclick = () => deleteMessage(id)
    div.appendChild(deleteBtn)
  }
}
  msgs.appendChild(div)
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

	ws.send(JSON.stringify({
		type: 'delete',
		id: id
	}))
}

function setStatus(state, label) {
  const el = document.getElementById('status')
  el.className = state
  el.textContent = label
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Enter key handlers
document.getElementById('username-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinChat()
})
document.getElementById('msg-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage()
})
</script>
</body>
</html>`
	return new Response(html, {
		headers: {
			'Content-Type': 'text/html;charset=UTF-8',
		}
	})
}

async function handleWebSocket(request, env) {
	const url = new URL(request.url)
	const username = url.searchParams.get('username') || 'Anonymous'

	// Get the Durable Object stub for our single room
	const id = env.CHATROOM.idFromName(ROOM_ID)
	const stub = env.CHATROOM.get(id)

	// Forward to the Durable Object for WebSocket upgrade
	return await stub.fetch(
		new Request('http://internal/websocket?username=' + encodeURIComponent(username), {
			headers: { 'Upgrade': 'websocket' }
		})
	)
}

export { Chatroom }