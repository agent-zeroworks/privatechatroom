// WS smoke test against wrangler dev (local).
// Every room is private now (v0.11.2 — public room deleted):
// 1) A room: chat persists after a hard disconnect.
// 2) Closing a room is just leaving — chats persist (v0.10.0).
//
// NOTE (v0.8.0+): both lanes are door-locked. Run against a local
// wrangler dev with the door disabled, or send the hl_door cookie.

const BASE = 'ws://127.0.0.1:8787/chat'

function connect(room, username, token) {
  return new Promise((resolve, reject) => {
    const url = BASE + '?room=' + room + '&username=' + encodeURIComponent(username) + (token ? '&token=' + token : '')
    const ws = new WebSocket(url)
    const events = []
    const timers = []
    ws.onmessage = (e) => events.push(JSON.parse(e.data))
    ws.onerror = (e) => reject(new Error('ws error ' + room))
    ws.onopen = () => resolve({ ws, events, timers })
  })
}

const wait = (ms) => new Promise(r => setTimeout(r, ms))
const has = (events, type, text) => events.some(e => e.type === type && (!text || e.text === text || (e.messages && e.messages.some(m => m.text === text))))

function closeSocket(ws) {
  try { ws.close() } catch (e) { /* already closed */ }
}

// ---------- TEST 1: room persistence across hard disconnect ----------
console.log('TEST 1: room persistence across hard disconnect')
const token = await getSession('smoketest@minx.local')
let a = await connect('SMOKE1A', 'joun', token)
await wait(400)
a.ws.send(JSON.stringify({ type: 'chat', text: 'hello private room' }))
await wait(500)
console.log('  echo received:', has(a.events, 'chat', 'hello private room'))
console.log('  join system msg:', has(a.events, 'system', 'joun joined'))
console.log('  online count:', a.events.find(e => e.type === 'online_count')?.count)

// hard disconnect (no close message) — like closing the tab
closeSocket(a.ws)
await wait(600)

let b = await connect('SMOKE1A', 'joun', token)
await wait(500)
console.log('  history persists after disconnect:', has(b.events, 'history', 'hello private room'))
closeSocket(b.ws)
await wait(300)

// ---------- TEST 2: room chats persist across close ----------
// Rooms need a session (v0.3.0+): request a magic link, verify it,
// then connect with the session token. v0.10.0: closing a room is just
// leaving — history stays for anyone with the code.
console.log('TEST 2: room chats persist across close')

async function getSession(email) {
  const req = await fetch('http://127.0.0.1:8787/auth/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, nickname: 'joun' })
  })
  const reqData = await req.json()
  const ver = await fetch('http://127.0.0.1:8787/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code: reqData.devCode })
  })
  const verData = await ver.json()
  if (!verData.session) throw new Error('no session: ' + JSON.stringify(verData))
  return verData.session
}

const token2 = await getSession('smoketest@minx.local')
function connectPrivate(room, t) {
  return connect(room, 'joun', t)
}

let c = await connectPrivate('PRVTEST2', token2)
await wait(400)
c.ws.send(JSON.stringify({ type: 'chat', text: 'secret message' }))
await wait(500)
console.log('  chat echoed:', has(c.events, 'chat', 'secret message'))

c.ws.send(JSON.stringify({ type: 'close' }))
await wait(700)

let d = await connectPrivate('PRVTEST2', token2)
await wait(500)
const hist = d.events.find(e => e.type === 'history')
console.log('  history after close (expect 1 message):', hist ? hist.messages.length : 'NO HISTORY EVENT')
console.log('  secret message survived the close:', has(d.events, 'history', 'secret message'))
closeSocket(d.ws)
await wait(300)

// ---------- TEST 3: private room with two users, one closes, other stays ----------
console.log('TEST 3: one of two closes, room survives')
let e = await connectPrivate('SECRET99', token)
await wait(300)
let f = await connectPrivate('SECRET99', token)
await wait(400)
e.ws.send(JSON.stringify({ type: 'chat', text: 'are you there bob' }))
await wait(400)
f.ws.send(JSON.stringify({ type: 'close' }))   // bob closes, alice still in
await wait(600)
console.log('  alice still connected:', e.ws.readyState === WebSocket.OPEN)
let g = await connectPrivate('SECRET99', token)
await wait(500)
console.log('  history survives (bob closed, alice in):', has(g.events, 'history', 'are you there bob'))
closeSocket(e.ws)
closeSocket(g.ws)
await wait(400)
// now everyone is gone (alice hard-disconnected, bob closed) — with
// persistence (v0.10.0) the room survives regardless: closing is leaving.
let h = await connectPrivate('SECRET99', token)
await wait(500)
const hist2 = h.events.find(e2 => e2.type === 'history')
console.log('  history after all gone w/o explicit close (persists):', hist2 ? hist2.messages.length : 'NO HISTORY')
closeSocket(h.ws)

// ---------- TEST 4: reopen after close keeps everything (v0.10.0) ----------
console.log('TEST 4: reopen after close keeps everything')
let i = await connectPrivate('RETRY999', token)
await wait(300)
i.ws.send(JSON.stringify({ type: 'chat', text: 'first life' }))
await wait(400)
i.ws.send(JSON.stringify({ type: 'close' }))
await wait(600)

let j = await connectPrivate('RETRY999', token)
await wait(400)
j.ws.send(JSON.stringify({ type: 'chat', text: 'second life' }))
await wait(400)
j.ws.send(JSON.stringify({ type: 'close' }))
await wait(600)

let k = await connectPrivate('RETRY999', token)
await wait(400)
const hist3 = k.events.find(e => e.type === 'history')
console.log('  history after second close (expect 2 messages):', hist3 ? hist3.messages.length : 'NO HISTORY')
console.log('  first life survived:', has(k.events, 'history', 'first life'))
console.log('  second life survived:', has(k.events, 'history', 'second life'))
closeSocket(k.ws)
console.log('DONE')
process.exit(0)
