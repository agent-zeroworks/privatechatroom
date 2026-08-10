// v0.8.2: test accounts on the public landing — one tap signs in and
// joins the PUBLIC room with identity + role.
// 1) Public room walk-in (no token): stays anonymous, role=user.
// 2) Public room with a test-agent session: sender is 'Test Agent', role=agent.
// 3) Public room with a test-user session: sender is 'Test User', role=user.
// Also: the landing HTML shows the test box FIRST, before the public room title.

import WebSocket from 'ws'

const BASE = 'http://127.0.0.1:8787'
const WS_BASE = 'ws://127.0.0.1:8787/chat'
const PUBLIC = 'CATCAFE8'

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

function connect(room, username, token) {
  return new Promise((resolve, reject) => {
    let url = WS_BASE + '?room=' + room + '&username=' + encodeURIComponent(username)
    if (token) url += '&token=' + encodeURIComponent(token)
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

// ---------- TEST 0: landing page order ----------
console.log('TEST 0: landing page')
const html = await (await api('/')).text()
const boxAt = html.indexOf('id="dev-test-box"')
const titleAt = html.indexOf('<h1>Public room</h1>')
check('test box present', boxAt !== -1)
check('test box is FIRST on the landing page', boxAt !== -1 && titleAt !== -1 && boxAt < titleAt, 'box@' + boxAt + ' title@' + titleAt)
const signin = html.indexOf('id="signin"')
check('sign-in screen no longer has the box', signin === -1 || !html.slice(signin, signin + 2500).includes('dev-test-box'))

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

// ---------- TEST 2: test agent joins the public room ----------
console.log('TEST 2: test agent in the public room')
const agentRes = await api('/auth/dev-test', { role: 'agent' })
const agent = await agentRes.json()
check('agent session minted', agentRes.ok && agent.ok === true)

const agentSide = await connect(PUBLIC, 'ignored-name', agent.session)
await wait(500)
agentSide.ws.send(JSON.stringify({ type: 'chat', text: 'hello public, from the agent side' }))
await wait(500)
const onAgentSide = agentSide.events.find(e => e.type === 'chat' && e.text === 'hello public, from the agent side')
check('agent sender is account name', onAgentSide && onAgentSide.sender === 'Test Agent', onAgentSide && onAgentSide.sender)
check('agent role rides the wire', onAgentSide && onAgentSide.role === 'agent', onAgentSide && onAgentSide.role)
closeSocket(agentSide.ws)
await wait(300)

// ---------- TEST 3: test user joins the public room ----------
console.log('TEST 3: test user in the public room')
const userRes = await api('/auth/dev-test', { role: 'user' })
const user = await userRes.json()
check('user session minted', userRes.ok && user.ok === true)

const userSide = await connect(PUBLIC, 'ignored-name', user.session)
await wait(500)
userSide.ws.send(JSON.stringify({ type: 'chat', text: 'hi public, human here' }))
await wait(500)
const onUserSide = userSide.events.find(e => e.type === 'chat' && e.text === 'hi public, human here')
check('user sender is account name', onUserSide && onUserSide.sender === 'Test User', onUserSide && onUserSide.sender)
check('user role is user', onUserSide && onUserSide.role === 'user', onUserSide && onUserSide.role)
closeSocket(userSide.ws)

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)')
process.exit(failures === 0 ? 0 : 1)
