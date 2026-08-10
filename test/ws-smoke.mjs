// WS smoke test against wrangler dev (local).
// 1) Public room: chat persists after a hard disconnect.
// 2) Private room: explicitly closing it destroys it (history gone).

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

// ---------- TEST 1: public room persistence ----------
console.log('TEST 1: public room persistence')
let a = await connect('CATCAFE8', 'minx')
await wait(400)
a.ws.send(JSON.stringify({ type: 'chat', text: 'hello public room' }))
await wait(500)
console.log('  echo received:', has(a.events, 'chat', 'hello public room'))
console.log('  join system msg:', has(a.events, 'system', 'minx joined'))
console.log('  online count:', a.events.find(e => e.type === 'online_count')?.count)

// hard disconnect (no close message) — like closing the tab
closeSocket(a.ws)
await wait(600)

let b = await connect('CATCAFE8', 'visitor')
await wait(500)
console.log('  history persists after disconnect:', has(b.events, 'history', 'hello public room'))
closeSocket(b.ws)
await wait(300)

// ---------- TEST 2: private room close-to-destroy ----------
// Private rooms need a session (v0.3.0+): request a magic link, verify it,
// then connect with the session token.
console.log('TEST 2: private room close-to-destroy')

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

const token = await getSession('smoketest@minx.local')
function connectPrivate(room, t) {
  return connect(room, 'joun', t)
}

let c = await connectPrivate('PRVTEST2', token)
await wait(400)
c.ws.send(JSON.stringify({ type: 'chat', text: 'secret message' }))
await wait(500)
console.log('  chat echoed:', has(c.events, 'chat', 'secret message'))

c.ws.send(JSON.stringify({ type: 'close' }))
await wait(700)

let d = await connectPrivate('PRVTEST2', token)
await wait(500)
const hist = d.events.find(e => e.type === 'history')
console.log('  history after close (expect empty):', hist ? hist.messages.length : 'NO HISTORY EVENT')
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
// now everyone gone but nobody sent close from alice... alice just disconnected.
// alice never closed explicitly → closedBy is empty → room NOT destroyed
let h = await connectPrivate('SECRET99', token)
await wait(500)
const hist2 = h.events.find(e2 => e2.type === 'history')
console.log('  history after all gone w/o explicit close (persists):', hist2 ? hist2.messages.length : 'NO HISTORY')
closeSocket(h.ws)

// ---------- TEST 4: destroy → reopen → destroy again (regression) ----------
console.log('TEST 4: reopen after destroy can be destroyed again')
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
console.log('  history after second close (expect empty):', hist3 ? hist3.messages.length : 'NO HISTORY')
closeSocket(k.ws)
console.log('DONE')
process.exit(0)
