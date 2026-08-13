// Shared constants between the Worker and the Durable Object.

// The one room everyone can walk into. Never destroyed, history persists.
export const PUBLIC_ROOM = 'CATCAFE8'

// Clean alphabet — no 0/O/1/I lookalikes. 8 chars.
export const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/

// ---------------------------------------------------------------------------
// Private room lifecycle — REAL PERSISTENCE (v0.10.0)
// ---------------------------------------------------------------------------
// Rooms never expire. Chats save forever inside the room, and the room
// only opens to people who have the code — the code is the key, and the
// key is the only way in. Closing a room is just leaving; the door stays.
// Legacy rooms stamped with the old one-week deadline convert to
// permanent on first load (see Chatroom.loadMeta).
export const ROOM_LIFETIME_MS = null // null = rooms never expire

// ---------------------------------------------------------------------------
// Magic-link delivery — TEMPORARY: no email provider yet.
// ---------------------------------------------------------------------------
// With SHOW_CODE_INLINE on, the magic link + 6-digit code are shown on
// screen after "send" (works on prod AND dev, so the official build is
// usable today). THE DAY AN EMAIL PROVIDER SHIPS: set this to false and
// wire the provider in handleAuthRequest — the link gets emailed instead
// of displayed. The test-account endpoint stays dev-only regardless.
//
// v0.9.0: the moment a RESEND_API_KEY secret exists, magic links are
// emailed automatically (SHOW_CODE_INLINE only applies when there is no
// key). One provider, two jobs: magic links AND away-notifications.
export const SHOW_CODE_INLINE = true

// ---------------------------------------------------------------------------
// Away-notifications (v0.9.0) — flag-gated, inert until a provider ships.
// ---------------------------------------------------------------------------
// When a message lands in a room and a signed-in member isn't connected,
// the server holds a digest and emails it after a quiet window. Scarce by
// design: never per-message, never more than one email per recipient per
// room within NOTIFY_MIN_GAP_MS. With NOTIFY_ENABLED=false the digest is
// built and logged (dry run) but nothing is sent.
//
// THE DAY EMAIL SHIPS (Resend): add the RESEND_API_KEY secret + set
// NOTIFY_ENABLED=true. That's it — the digest machinery is already live.
export const NOTIFY_ENABLED = false
export const NOTIFY_DIGEST_WAIT_MS = 5 * 60 * 1000   // hold unread ~5 min before emailing
export const NOTIFY_MIN_GAP_MS = 30 * 60 * 1000      // min gap between emails per recipient
export const NOTIFY_CODE_TTL_S = 7 * 24 * 3600       // one-tap link lives a week
export const NOTIFY_FROM_NAME = 'Heartline'
export const NOTIFY_FROM_EMAIL = 'heartline@thegreateater0.dev' // placeholder until a domain is verified

// ---------------------------------------------------------------------------
// Door codes (v0.8.0) — BOTH LANES are code-locked now.
// ---------------------------------------------------------------------------
// Every request to a locked worker must carry the hl_door cookie, which only
// /door/unlock can mint. Dev and prod have their own codes (Joun picked
// 1221 for the official, 9119 stays on the test build). It's a polite door
// (anyone who can read the worker source can find the code), not a vault:
// it keeps randoms from wandering into a preview.
export const DOOR_ENABLED = { dev: true, prod: true }
export const DOOR_CODES = { dev: '9119', prod: '1221' }
export const DOOR_COOKIE = 'hl_door'
export const DOOR_COOKIE_VALUE = 'open'
// Failed attempts per IP before a 60s cooldown (5 tries/min).
export const DOOR_MAX_ATTEMPTS = 5
export const DOOR_WINDOW_S = 60
