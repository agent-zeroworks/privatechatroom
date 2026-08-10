// v0.8.3: test buttons are TAG-ONLY toggles now. Clicking Test Agent adds
// the AGENT tag to whoever clicks it — no session, no identity change,
// no redirect. The tag works in the public room AND private rooms.
// 1) Public walk-in (no token, no tag): stays anonymous, role=user.
// 2) Public walk-in WITH tag=agent: keeps their typed name, role=agent.
// 3) Live flip: chat as user, send {type:'tag',tag:'agent'}, chat again ->
//    second message role=agent; tag_ack received; clear restores role.
// 4) Private room: own session + tag=agent -> account name, role=agent.
// Also: the landing page shows the tag box FIRST (class .tag-test-box),
// the private-join screen carries one too, and the sign-in screen does not.

import WebSocket from 'ws'

const BASE = 'http://127.0.0.1:8787'
const WS_BASE = 'ws://127.0.0.1:8787/chat'
const PUBLIC = 'CATCAFE8'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

let failures = 0
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined ? '  [' + extra + ']' : ''))
  if (!cond) failures++
}

const wait = (ms) => new Promise(r => setTimeout(r, ms))

// ---------- door ----------
const unlockRes = await fetch(BASE + '/door/unlock', {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'code=9119'
})
const cookie = (unlockRes.headers.get('set-cookie') || '').split(';')[0]
check('door unlocked (9119)', (unlockRes.status === 302 || unlockRes.ok) && !!cookie, cookie)

function connect(room, username, token, tag) {
  return new Promise((resolve, reject) => {
    let url = WS_BASE + '?room=' + room + '&username=' + encodeURIComponent(username)
    if (token) url += '&token=' + encodeURIComponent(token)
    if (tag) url += '&tag=' + encodeURIComponent(tag)
    const ws = new WebSocket(url, { headers: { Cookie: cookie } })
    const events = []
    ws.on('message', (d) => events.push(JSON.parse(d.toString())))
    ws.on('error', (e) => reject(new Error('ws error ' + room + ': ' + e.message)))
    ws.on('open', () => resolve({ ws, events }))
  })
}

function closeSocket(ws) {
  try { ws.close() } catch (e) { /* already closed */ }
}

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: body ? JSON.stringify(body) : undefined
  })
  return res
}

// Magic-link session with a custom nickname — proves the tag rides on top
// of YOUR identity (name stays yours, only the tag changes).
async function getSession(email, nickname) {
  const req = await api('/auth/request', { email, nickname })
  const reqData = await req.json()
  const ver = await api('/auth/verify', { email, code: reqData.devCode })
  const verData = await ver.json()
  if (!verData.session) throw new Error('no session: ' + JSON.stringify(verData))
  return verData.session
}

function randomCode() {
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  }
  return code
}

// ---------- TEST 0: landing page ----------
console.log('TEST 0: landing page')
const html = await (await api('/')).text()
const boxAt = html.indexOf('class="tag-test-box"')
const titleAt = html.indexOf('<h1>Public room</h1>')
check('tag box present', boxAt !== -1)
check('tag box is FIRST on the landing page', boxAt !== -1 && titleAt !== -1 && boxAt < titleAt, 'box@' + boxAt + ' title@' + titleAt)
check('private join screen has its own tag box', html.indexOf('id="private-join"') !== -1 && html.indexOf('class="tag-test-box"', html.indexOf('id="private-join"')) !== -1)
check('no instant-account session box anymore', !html.includes('dev-test-user-btn') && !html.includes('dev-test-agent-btn'))
check('in-chat tag toggle present', html.includes('id="tag-header-btn"'))
const signin = html.indexOf('id="signin"')
check('sign-in screen has no tag box', signin === -1 || !html.slice(signin, signin + 2500).includes('tag-test-box'))

// ---------- TEST 1: walk-in stays anonymous ----------
console.log('TEST 1: anonymous walk-in')
const walker = await connect(PUBLIC, 'CuriousCat')
await wait(500)
walker.ws.send(JSON.stringify({ type: 'chat', text: 'just passing through' }))
await wait(500)
const onWalker = walker.events.find(e => e.type === 'chat' && e.text === 'just passing through')
check('walker sender is typed name', onWalker && onWalker.sender === 'CuriousCat', onWalker && onWalker.sender)
check('walker role is user', onWalker && onWalker.role === 'user', onWalker && onWalker.role)
closeSocket(walker.ws)
await wait(300)

// ---------- TEST 2: walk-in with the test tag ----------
console.log('TEST 2: walk-in + tag=agent (the tag-only button)')
const tagged = await connect(PUBLIC, 'CuriousCat', null, 'agent')
await wait(500)
tagged.ws.send(JSON.stringify({ type: 'chat', text: 'tagged message' }))
await wait(500)
const onTagged = tagged.events.find(e => e.type === 'chat' && e.text === 'tagged message')
check('sender keeps their own name', onTagged && onTagged.sender === 'CuriousCat', onTagged && onTagged.sender)
check('role is agent (tag applied)', onTagged && onTagged.role === 'agent', onTagged && onTagged.role)

// Clearing must restore the BASE role (user) even though this connection
// OPENED with tag=agent — the tag is an overlay, not the identity.
tagged.ws.send(JSON.stringify({ type: 'tag', tag: '' }))
await wait(400)
const clearAck = tagged.events.find(e => e.type === 'tag_ack')
check('clear ack restores user', clearAck && clearAck.role === 'user', clearAck && clearAck.role)
tagged.ws.send(JSON.stringify({ type: 'chat', text: 'after clear on tagged conn' }))
await wait(400)
const afterClear = tagged.events.find(e => e.type === 'chat' && e.text === 'after clear on tagged conn')
check('role back to user after clear', afterClear && afterClear.role === 'user', afterClear && afterClear.role)
closeSocket(tagged.ws)
await wait(300)

// ---------- TEST 3: live flip mid-room ----------
console.log('TEST 3: live tag flip without reconnecting')
const flipper = await connect(PUBLIC, 'FlipCat')
await wait(500)
flipper.ws.send(JSON.stringify({ type: 'chat', text: 'before the flip' }))
await wait(400)
flipper.ws.send(JSON.stringify({ type: 'tag', tag: 'agent' }))
await wait(400)
const ack = flipper.events.find(e => e.type === 'tag_ack')
check('tag_ack received', !!ack && ack.role === 'agent', ack && ack.role)
flipper.ws.send(JSON.stringify({ type: 'chat', text: 'after the flip' }))
await wait(400)
flipper.ws.send(JSON.stringify({ type: 'tag', tag: '' }))
await wait(400)
const ack2 = flipper.events.find(e => e.type === 'tag_ack' && e !== ack)
check('clear ack restores user role', !!ack2 && ack2.role === 'user', ack2 && ack2.role)
flipper.ws.send(JSON.stringify({ type: 'chat', text: 'after the clear' }))
await wait(400)
const before = flipper.events.find(e => e.type === 'chat' && e.text === 'before the flip')
const after = flipper.events.find(e => e.type === 'chat' && e.text === 'after the flip')
const cleared = flipper.events.find(e => e.type === 'chat' && e.text === 'after the clear')
check('before flip: role user', before && before.role === 'user', before && before.role)
check('after flip: role agent', after && after.role === 'agent', after && after.role)
check('after clear: role user again', cleared && cleared.role === 'user', cleared && cleared.role)
closeSocket(flipper.ws)
await wait(300)

// ---------- TEST 4: test tag inside a private room ----------
console.log('TEST 4: test agent in a private room (own identity + tag)')
const token = await getSession('tagtest' + Date.now() + '@minx.local', 'JounTest')
const room = randomCode()
const priv = await connect(room, 'ignored-name', token, 'agent')
await wait(500)
priv.ws.send(JSON.stringify({ type: 'chat', text: 'private tagged hello' }))
await wait(500)
const onPriv = priv.events.find(e => e.type === 'chat' && e.text === 'private tagged hello')
check('private sender is the account name', onPriv && onPriv.sender === 'JounTest', onPriv && onPriv.sender)
check('private role is agent (tag applied)', onPriv && onPriv.role === 'agent', onPriv && onPriv.role)
closeSocket(priv.ws)
await wait(300)

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)')
process.exit(failures === 0 ? 0 : 1)
