// Shared constants between the Worker and the Durable Object.

// The one room everyone can walk into. Never destroyed, history persists.
export const PUBLIC_ROOM = 'CATCAFE8'

// Clean alphabet — no 0/O/1/I lookalikes. 8 chars.
export const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/

// ---------------------------------------------------------------------------
// Private room lifecycle — TEMPORARY PLACEHOLDER POLICY
// ---------------------------------------------------------------------------
// A room created with the generate-code button keeps the CLASSIC lifecycle
// during its first week: when every party closes the room, it deletes
// itself (history wiped, code reusable for a fresh room). A room that is
// still alive ROOM_LIFETIME_MS after first use goes DORMANT instead:
// locked to new visitors, history and identity preserved, code reserved —
// that reserved pool is the future rental inventory.
//
// THE DAY REAL PERSISTENCE SHIPS — this is the whole activation:
//   1. set ROOM_LIFETIME_MS to null   (new rooms never expire)
//   2. set REVIVE_DORMANT to true     (old dormant rooms wake on next visit)
// No other code changes needed.
export const ROOM_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000 // 1 week (placeholder)
export const REVIVE_DORMANT = false

// ---------------------------------------------------------------------------
// Magic-link delivery — TEMPORARY: no email provider yet.
// ---------------------------------------------------------------------------
// With SHOW_CODE_INLINE on, the magic link + 6-digit code are shown on
// screen after "send" (works on prod AND dev, so the official build is
// usable today). THE DAY AN EMAIL PROVIDER SHIPS: set this to false and
// wire the provider in handleAuthRequest — the link gets emailed instead
// of displayed. The test-account endpoint stays dev-only regardless.
export const SHOW_CODE_INLINE = true

// ---------------------------------------------------------------------------
// Test-build door code (v0.7.0) — DEV WORKER ONLY.
// ---------------------------------------------------------------------------
// The test build is code-locked: every request to the dev worker must carry
// the hl_door cookie, which only /door/unlock can mint. Prod never checks
// this — the official build stays walkable. It's a polite door (anyone who
// can read the worker source can find the code), not a vault: it keeps
// randoms from wandering in, which is all a test lane needs.
export const DOOR_CODE = '9119'
export const DOOR_COOKIE = 'hl_door'
export const DOOR_COOKIE_VALUE = 'open'
// Failed attempts per IP before a 60s cooldown (5 tries/min).
export const DOOR_MAX_ATTEMPTS = 5
export const DOOR_WINDOW_S = 60
