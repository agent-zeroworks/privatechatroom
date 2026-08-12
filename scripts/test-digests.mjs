// Offline logic test for the v0.9.0 digest state machine.
// Mocks DO storage + KV so queueDigests/alarm run without the CF runtime.
import { Chatroom } from '../src/chatroom.js'

const storage = new Map()
let alarm = null

const fakeStorage = {
	get: async (k) => storage.get(k),
	put: async (k, v) => { storage.set(k, v) },
	delete: async (k) => { storage.delete(k) },
	deleteAll: async () => { storage.clear() },
	getAlarm: async () => alarm,
	setAlarm: async (t) => { alarm = t }
}

const kv = new Map()
const fakeKV = {
	get: async (k) => kv.get(k) ?? null,
	put: async (k, v) => { kv.set(k, v) },
	delete: async (k) => { kv.delete(k) }
}

function makeRoom() {
	return new Chatroom(
		{ id: { name: 'room-TESTROOM' }, storage: fakeStorage },
		{ ROOM_KV: fakeKV, APP_ENV: 'test' }
	)
}

let failures = 0
function assert(cond, label) {
	if (cond) { console.log('  ok —', label) } else { console.error('  FAIL —', label); failures++ }
}

// Seed: two members, one connected, one away.
storage.set('members', [
	['away@test.dev', { nickname: 'Away', firstSeen: Date.now(), origin: 'https://x.dev' }],
	['here@test.dev', { nickname: 'Here', firstSeen: Date.now(), origin: 'https://x.dev' }]
])
storage.set('pendingDigests', [])

const room = makeRoom()
room.sessions.set({ dummy: true }, { username: 'Here', role: 'user', baseRole: 'user', email: 'here@test.dev' })

console.log('— queueDigests —')
const msg = { sender: 'Here', text: 'are you there?', ts: Date.now() }
await room.queueDigests(msg)
assert(room.pendingDigests.has('away@test.dev'), 'away member got a digest entry')
assert(!room.pendingDigests.has('here@test.dev'), 'connected member skipped')
assert(room.pendingDigests.get('away@test.dev').count === 1, 'count is 1')
assert(alarm !== null, 'alarm scheduled')

// Second message before flush: count grows, single entry stays.
await room.queueDigests({ sender: 'Here', text: 'second ping', ts: Date.now() })
assert(room.pendingDigests.get('away@test.dev').count === 2, 'count grows to 2, still one entry')

console.log('— alarm flush —')
// CF consumes an alarm when it fires; mimic that before each alarm() call.
alarm = null
await room.alarm()
assert(room.pendingDigests.size === 0, 'digest cleared after flush')
assert(room.pendingDigests.get && !room.pendingDigests.has('away@test.dev'), 'entry removed from map')
const persisted = storage.get('pendingDigests')
assert(Array.isArray(persisted) && persisted.length === 0, 'storage updated')

// After flush: new message → gap respected (lastSentAt recent → no resend until 30 min).
alarm = null
await room.queueDigests({ sender: 'Here', text: 'third ping', ts: Date.now() })
alarm = null
await room.alarm()
assert(room.pendingDigests.has('away@test.dev'), 'min-gap holds the next digest (not flushed)')
assert(room.pendingDigests.get('away@test.dev').count === 1, 'held digest keeps count')

// Once the gap passes, the held digest flushes and lastSentAt moves.
const member = room.members.get('away@test.dev')
member.lastSentAt = Date.now() - 31 * 60 * 1000  // pretend 31 min passed
alarm = null
await room.alarm()
assert(!room.pendingDigests.has('away@test.dev'), 'after gap, digest flushes')
assert(member.lastSentAt > Date.now() - 60 * 1000, 'member lastSentAt refreshed')

console.log(failures === 0 ? '\nALL DIGEST TESTS PASSED' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
