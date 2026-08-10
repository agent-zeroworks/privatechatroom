// Smoke test for v0.5.0: instant test accounts (dev only).
// 1) /auth/dev-test mints user + agent sessions in one click, no email step.
// 2) /auth/me reports the role back.
// 3) Two WS connections (user + agent) in the same private room: chat
//    messages carry the sender's role, verified from the other side.

const BASE = 'http://127.0.0.1:8787'
const WS_BASE = 'ws://127.0.0.1:8787/chat'

let failures = 0
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (extra !== undefined ? '  [' + extra + ']' : ''))
  if (!cond) failures++
}

const wait = (ms) => new Promise(r => setTimeout(r, ms))

// ---------- door (v0.7.0+: dev worker is code-locked) ----------
const unlockRes = await fetch(BASE + '/door/unlock', {
  method: 'POST',
  redirect: 'manual',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'code=9119'
})
const cookie = (unlockRes.headers.get('set-cookie') || '').split(';')[0]

function connect(room, token, role) {
  return new Promise((resolve, reject) => {
    const url = WS_BASE + '?room=' + room + '&username=' + encodeURIComponent('x') +
      '&token=' + encodeURIComponent(token) + '&role=' + encodeURIComponent(role)
    const ws = new WebSocket(url, { headers: { Cookie: cookie } })
    const events = []
    ws.onmessage = (e) => events.push(JSON.parse(e.data))
    ws.onerror = (e) => reject(new Error('ws error ' + room))
    ws.onopen = () => resolve({ ws, events })
  })
}

function closeSocket(ws) {
  try { ws.close() } catch (e) { /* already closed */ }
}

// ---------- TEST 1: instant sessions ----------
console.log('TEST 1: instant test sessions')
const userRes = await fetch(BASE + '/auth/dev-test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ role: 'user' })
})
const user = await userRes.json()
check('user session minted', userRes.ok && user.ok === true)
check('user role is user', user.role === 'user', user.role)
check('user identity fixed', user.email === 'test.user@minx.dev' && user.nickname === 'Test User')

const agentRes = await fetch(BASE + '/auth/dev-test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify({ role: 'agent' })
})
const agent = await agentRes.json()
check('agent session minted', agentRes.ok && agent.ok === true)
check('agent role is agent', agent.role === 'agent', agent.role)
check('agent identity fixed', agent.email === 'test.agent@minx.dev' && agent.nickname === 'Test Agent')

// ---------- TEST 2: /auth/me reports role ----------
console.log('TEST 2: /auth/me')
const meUser = await (await fetch(BASE + '/auth/me?token=' + user.session, { headers: { Cookie: cookie } })).json()
check('me(user) role', meUser.ok && meUser.role === 'user', meUser.role)
const meAgent = await (await fetch(BASE + '/auth/me?token=' + agent.session, { headers: { Cookie: cookie } })).json()
check('me(agent) role', meAgent.ok && meAgent.role === 'agent', meAgent.role)

// ---------- TEST 3: roles ride the wire ----------
console.log('TEST 3: roles in chat messages')
// Room codes exclude 0/O/1/I — HUMAGENT is clean.
const ROOM = 'HUMAGENT'
const a = await connect(ROOM, user.session, 'user')
const b = await connect(ROOM, agent.session, 'agent')
await wait(500)

a.ws.send(JSON.stringify({ type: 'chat', text: 'hello from the human side' }))
await wait(500)
const onAgentSide = b.events.find(e => e.type === 'chat' && e.text === 'hello from the human side')
check('agent sees user msg with role=user', onAgentSide && onAgentSide.role === 'user', onAgentSide && onAgentSide.role)

b.ws.send(JSON.stringify({ type: 'chat', text: 'hello from the agent side' }))
await wait(500)
const onUserSide = a.events.find(e => e.type === 'chat' && e.text === 'hello from the agent side')
check('user sees agent msg with role=agent', onUserSide && onUserSide.role === 'agent', onUserSide && onUserSide.role)

// History should carry roles too (fresh join after both messaged)
closeSocket(a.ws)
closeSocket(b.ws)
await wait(500)
const c = await connect(ROOM, user.session, 'user')
await wait(500)
const hist = c.events.find(e => e.type === 'history')
const histAgent = hist && hist.messages.find(m => m.text === 'hello from the agent side')
check('history preserves role', histAgent && histAgent.role === 'agent', histAgent && histAgent.role)
closeSocket(c.ws)

console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILURE(S)')
process.exit(failures === 0 ? 0 : 1)
