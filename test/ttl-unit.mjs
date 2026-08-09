// Unit test for pruneExpired — the 24h per-message TTL math.
// Runs locally against the real Chatroom class with a mocked storage.

import { Chatroom } from '../src/chatroom.js'

function makeRoom(isPublic, storedMessages) {
  const storage = {
    _data: { messages: storedMessages },
    async get(key) { return this._data[key] },
    async put(key, val) { this._data[key] = val },
    async delete(key) { delete this._data[key] },
    calls: [],
  }
  // trace puts/deletes
  const origPut = storage.put.bind(storage)
  const origDelete = storage.delete.bind(storage)
  storage.put = async (k, v) => { storage.calls.push('put'); return origPut(k, v) }
  storage.delete = async (k) => { storage.calls.push('delete'); return origDelete(k) }

  const room = new Chatroom(
    { id: { name: isPublic ? 'room-CATCAFE8' : 'room-ABCD2345' }, storage },
    {}
  )
  room.loaded = true
  room.messages = [...storedMessages]
  return room
}

const now = Date.now()
let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name)
  if (!cond) failures++
}

// 1) public room: drops messages older than 24h, keeps fresh ones
{
  const room = makeRoom(true, [
    { id: 'old', sender: 'a', text: 'over a day old', ts: now - 25 * 3600 * 1000 },
    { id: 'fresh', sender: 'b', text: 'just now', ts: now - 60 * 1000 },
  ])
  await room.pruneExpired()
  check('public: old message dropped', !room.messages.some(m => m.id === 'old'))
  check('public: fresh message kept', room.messages.some(m => m.id === 'fresh'))
  check('public: storage persisted the prune', room.state.storage.calls.includes('put'))
}

// 2) public room: no-timestamp legacy messages count as expired
{
  const room = makeRoom(true, [
    { id: 'legacy', sender: 'a', text: 'no ts' },
    { id: 'fresh', sender: 'b', text: 'has ts', ts: now - 1000 },
  ])
  await room.pruneExpired()
  check('public: legacy no-ts message dropped', !room.messages.some(m => m.id === 'legacy'))
  check('public: ts message kept', room.messages.some(m => m.id === 'fresh'))
}

// 3) public room: everything expired -> storage key deleted
{
  const room = makeRoom(true, [
    { id: 'old1', sender: 'a', text: 'x', ts: now - 48 * 3600 * 1000 },
  ])
  await room.pruneExpired()
  check('public: all-expired empties messages', room.messages.length === 0)
  check('public: all-expired deletes storage key', room.state.storage.calls.includes('delete'))
}

// 4) public room: nothing expired -> no writes at all
{
  const room = makeRoom(true, [
    { id: 'fresh', sender: 'b', text: 'y', ts: now - 1000 },
  ])
  await room.pruneExpired()
  check('public: nothing expired -> untouched', room.messages.length === 1 && room.state.storage.calls.length === 0)
}

// 5) boundary: 24h minus a second is still kept (ts >= cutoff keeps)
{
  const room = makeRoom(true, [
    { id: 'edge', sender: 'a', text: 'almost 24h', ts: Date.now() - 24 * 3600 * 1000 + 1000 },
  ])
  await room.pruneExpired()
  check('boundary: just under 24h kept', room.messages.some(m => m.id === 'edge'))
}

// 6) private room: never pruned
{
  const room = makeRoom(false, [
    { id: 'secret', sender: 'a', text: 'old private', ts: now - 72 * 3600 * 1000 },
  ])
  await room.pruneExpired()
  check('private: old messages kept', room.messages.some(m => m.id === 'secret'))
  check('private: no storage writes', room.state.storage.calls.length === 0)
}

console.log(failures === 0 ? 'ALL TTL TESTS PASSED' : failures + ' TEST(S) FAILED')
process.exit(failures === 0 ? 0 : 1)
