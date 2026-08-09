// Live test against the deployed worker:
// 1) send a message to the public room
// 2) hard-disconnect, reconnect
// 3) verify history: message persisted, carries a ts, and no legacy no-ts messages remain
// 4) delete the test message to leave the room clean

const BASE = 'wss://minx-chatroom.thegreateater0.workers.dev/chat'
const MARK = 'ttl-check-' + Math.random().toString(36).slice(2, 8)
const USER = 'minx-test'

function connect(room, username) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE + '?room=' + room + '&username=' + encodeURIComponent(username))
    const events = []
    ws.onmessage = (e) => events.push(JSON.parse(e.data))
    ws.onerror = () => reject(new Error('ws error'))
    ws.onopen = () => resolve({ ws, events })
  })
}
const wait = (ms) => new Promise(r => setTimeout(r, ms))
const close = (ws) => { try { ws.close() } catch (e) {} }

let failures = 0
const check = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) failures++ }

// send
let a = await connect('CATCAFE8', USER)
await wait(400)
a.ws.send(JSON.stringify({ type: 'chat', text: MARK }))
await wait(500)
check('message echoed live', a.events.some(e => e.type === 'chat' && e.text === MARK && typeof e.ts === 'number'))
const sentId = (a.events.find(e => e.type === 'chat' && e.text === MARK) || {}).id
close(a.ws)
await wait(600)

// reconnect, check history
let b = await connect('CATCAFE8', USER)
await wait(600)
const hist = b.events.find(e => e.type === 'history')
const msgs = hist ? hist.messages : []
check('history served', !!hist)
check('test message persisted', msgs.some(m => m.text === MARK))
check('every history message has ts (legacy pruned)', msgs.every(m => typeof m.ts === 'number'))
check('no legacy no-ts messages left', !msgs.some(m => typeof m.ts !== 'number'))

// clean up: delete the test message
if (sentId) {
  b.ws.send(JSON.stringify({ type: 'delete', id: sentId }))
  await wait(500)
}
close(b.ws)
await wait(300)
console.log(failures === 0 ? 'LIVE TEST PASSED' : failures + ' LIVE TEST(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
