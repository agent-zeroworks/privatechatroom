// Unit test for the v0.4.1 lifecycle rules in maybeDestroy().
// Placeholder week: everyone closes -> room deletes itself.
// Dormant room: NEVER wiped (reserved stock for future rentals).
// Public room: the house, never destroyed.

import { Chatroom } from '../src/chatroom.js'

function makeRoom(isPublic, opts = {}) {
  const now = Date.now()
  const meta = opts.meta
  const storage = {
    _data: meta ? { meta } : {},
    calls: [],
    async get(key) { return this._data[key] },
    async put(key, val) { this._data[key] = val; this.calls.push('put:' + key) },
    async delete(key) { delete this._data[key]; this.calls.push('delete:' + key) },
    async deleteAll() { this._data = {}; this.calls.push('deleteAll') },
  }
  const room = new Chatroom(
    { id: { name: isPublic ? 'room-CATCAFE8' : 'room-ABCD2345' }, storage },
    {}
  )
  room.loaded = true
  return room
}

let failures = 0
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name)
  if (!cond) failures++
}

const freshMeta = { created_at: Date.now(), expires_at: Date.now() + 7 * 24 * 3600 * 1000 }
const dormantMeta = { created_at: Date.now() - 8 * 24 * 3600 * 1000, expires_at: Date.now() - 24 * 3600 * 1000 }

// 1) private, everyone closed, fresh -> destroyed
{
  const room = makeRoom(false, { meta: freshMeta })
  room.closedBy.add('sock1')
  await room.maybeDestroy()
  check('fresh room, all closed -> deleteAll called', room.state.storage.calls.includes('deleteAll'))
  check('fresh room, all closed -> destroyed flag', room.destroyed === true)
}

// 2) private, still people inside -> survives
{
  const room = makeRoom(false, { meta: freshMeta })
  room.closedBy.add('sock1')
  room.sessions.set('sock2', {})
  await room.maybeDestroy()
  check('room with live session -> NOT destroyed', room.destroyed === false && !room.state.storage.calls.includes('deleteAll'))
}

// 3) private, nobody explicitly closed -> survives (tab close = just leaving)
{
  const room = makeRoom(false, { meta: freshMeta })
  await room.maybeDestroy()
  check('no explicit close -> NOT destroyed', room.destroyed === false && !room.state.storage.calls.includes('deleteAll'))
}

// 4) dormant room -> NEVER wiped, even if everyone closed
{
  const room = makeRoom(false, { meta: dormantMeta })
  room.closedBy.add('sock1')
  await room.maybeDestroy()
  check('dormant room -> NOT destroyed (history preserved)', room.destroyed === false && !room.state.storage.calls.includes('deleteAll'))
}

// 5) public room -> the house never goes away
{
  const room = makeRoom(true, { meta: {} })
  room.closedBy.add('sock1')
  await room.maybeDestroy()
  check('public room -> NOT destroyed', room.destroyed === false && !room.state.storage.calls.includes('deleteAll'))
}

// 6) already destroyed -> no double wipe
{
  const room = makeRoom(false, { meta: freshMeta })
  room.destroyed = true
  room.closedBy.add('sock1')
  await room.maybeDestroy()
  check('already destroyed -> no second deleteAll', !room.state.storage.calls.includes('deleteAll'))
}

// 7) destroyed room revisitable: fresh meta stamped on next use (resurrect)
{
  const room = makeRoom(false, { meta: freshMeta })
  room.closedBy.add('sock1')
  await room.maybeDestroy()
  room.destroyed = false
  room.closedBy.clear()
  const meta = await room.ensureMeta()
  check('revisit after destroy -> fresh week stamped', !!meta.created_at && !!meta.expires_at)
  check('revisit after destroy -> storage rewritten', room.state.storage.calls.some(c => c === 'put:meta'))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
