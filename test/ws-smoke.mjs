// WS smoke test against wrangler dev (local).
// 1) Public room: chat persists after a hard disconnect.
// 2) Private room: explicitly closing it destroys it (history gone).

const BASE = 'ws://127.0.0.1:8787/chat'

function connect(room, username) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE + '?room=' + room + '&username=' + encodeURIComponent(username))
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
console.log('TEST 2: private room close-to-destroy')
let c = await connect('PRVTEST2', 'joun')
await wait(400)
c.ws.send(JSON.stringify({ type: 'chat', text: 'secret message' }))
await wait(500)
console.log('  chat echoed:', has(c.events, 'chat', 'secret message'))

c.ws.send(JSON.stringify({ type: 'close' }))
await wait(700)

let d = await connect('PRVTEST2', 'joun-again')
await wait(500)
const hist = d.events.find(e => e.type === 'history')
console.log('  history after close (expect empty):', hist ? hist.messages.length : 'NO HISTORY EVENT')
closeSocket(d.ws)
await wait(300)

// ---------- TEST 3: private room with two users, one closes, other stays ----------
console.log('TEST 3: one of two closes, room survives')
let e = await connect('SECRET99', 'alice')
await wait(300)
let f = await connect('SECRET99', 'bob')
await wait(400)
e.ws.send(JSON.stringify({ type: 'chat', text: 'are you there bob' }))
await wait(400)
f.ws.send(JSON.stringify({ type: 'close' }))   // bob closes, alice still in
await wait(600)
console.log('  alice still connected:', e.ws.readyState === WebSocket.OPEN)
let g = await connect('SECRET99', 'carol')
await wait(500)
console.log('  history survives (bob closed, alice in):', has(g.events, 'history', 'are you there bob'))
closeSocket(e.ws)
closeSocket(g.ws)
await wait(400)
// now everyone gone but nobody sent close from alice... alice just disconnected.
// alice never closed explicitly → closedBy is empty → room NOT destroyed
let h = await connect('SECRET99', 'dave')
await wait(500)
const hist2 = h.events.find(e2 => e2.type === 'history')
console.log('  history after all gone w/o explicit close (persists):', hist2 ? hist2.messages.length : 'NO HISTORY')
closeSocket(h.ws)

// ---------- TEST 4: destroy → reopen → destroy again (regression) ----------
console.log('TEST 4: reopen after destroy can be destroyed again')
let i = await connect('RETRY999', 'one')
await wait(300)
i.ws.send(JSON.stringify({ type: 'chat', text: 'first life' }))
await wait(400)
i.ws.send(JSON.stringify({ type: 'close' }))
await wait(600)

let j = await connect('RETRY999', 'two')
await wait(400)
j.ws.send(JSON.stringify({ type: 'chat', text: 'second life' }))
await wait(400)
j.ws.send(JSON.stringify({ type: 'close' }))
await wait(600)

let k = await connect('RETRY999', 'three')
await wait(400)
const hist3 = k.events.find(e => e.type === 'history')
console.log('  history after second close (expect empty):', hist3 ? hist3.messages.length : 'NO HISTORY')
closeSocket(k.ws)
console.log('DONE')
process.exit(0)
