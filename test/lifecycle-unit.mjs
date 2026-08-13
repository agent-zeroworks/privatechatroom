// Unit test for the v0.10.0 persistence rules.
// Real persistence: private room chats save forever, rooms only open to
// people with the code, and nothing ever wipes history — closing a room
// is just leaving. Legacy rooms stamped with the old one-week deadline
// convert to permanent on first load.

import { Chatroom } from '../src/chatroom.js'
import { ROOM_LIFETIME_MS } from '../src/config.js'

function makeRoom(isPublic, opts = {}) {
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

check('persistence is on (ROOM_LIFETIME_MS is null)', ROOM_LIFETIME_MS === null)

// 1) fresh private room -> stamped without an expiry (never expires)
{
  const room = makeRoom(false)
  const meta = await room.ensureMeta()
  check('fresh room has created_at', !!meta.created_at)
  check('fresh room expires_at is null (never expires)', meta.expires_at === null)
}

// 2) legacy room with a past one-week deadline -> converts to permanent on load
{
  const legacy = { created_at: Date.now() - 8 * 24 * 3600 * 1000, expires_at: Date.now() - 24 * 3600 * 1000 }
  const room = makeRoom(false, { meta: legacy })
  const meta = await room.loadMeta()
  check('legacy room converts expires_at to null', meta.expires_at === null)
  check('conversion persisted to storage', room.state.storage.calls.includes('put:meta'))
}

// 3) converted room is never dormant (history preserved, door open)
{
  const legacy = { created_at: Date.now() - 30 * 24 * 3600 * 1000, expires_at: Date.now() - 20 * 24 * 3600 * 1000 }
  const room = makeRoom(false, { meta: legacy })
  await room.loadMeta()
  check('converted room -> isDormant false', (await room.isDormant()) === false)
}

// 4) history is never wiped — no lifecycle op calls deleteAll
{
  const room = makeRoom(false)
  await room.ensureMeta()
  await room.loadMeta()
  await room.pruneExpired()
  check('no deleteAll in any lifecycle op', !room.state.storage.calls.includes('deleteAll'))
}

// 5) public room: house meta, never dormant, never wiped
{
  const room = makeRoom(true, { meta: {} })
  await room.loadMeta()
  check('public room -> not dormant', (await room.isDormant()) === false)
  check('public room -> no deleteAll', !room.state.storage.calls.includes('deleteAll'))
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
