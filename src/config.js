// Shared constants between the Worker and the Durable Object.

// The one room everyone can walk into. Never destroyed, history persists.
export const PUBLIC_ROOM = 'CATCAFE8'

// Clean alphabet — no 0/O/1/I lookalikes. 8 chars.
export const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/

// ---------------------------------------------------------------------------
// Private room lifecycle — TEMPORARY PLACEHOLDER POLICY
// ---------------------------------------------------------------------------
// A room created with the generate-code button lives ROOM_LIFETIME_MS after
// its first use, then its code goes DORMANT: locked to new visitors, history
// and identity preserved, ready to be revived later.
//
// THE DAY REAL PERSISTENCE SHIPS — this is the whole activation:
//   1. set ROOM_LIFETIME_MS to null   (new rooms never expire)
//   2. set REVIVE_DORMANT to true     (old dormant rooms wake on next visit)
// No other code changes needed.
export const ROOM_LIFETIME_MS = 60 * 1000 // TEMP TEST: 60s TTL to verify dormancy
export const REVIVE_DORMANT = false
