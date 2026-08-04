// Shared constants between the Worker and the Durable Object.

// The one room everyone can walk into. Never destroyed, history persists.
export const PUBLIC_ROOM = 'CATCAFE8'

// Clean alphabet — no 0/O/1/I lookalikes. 8 chars.
export const CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/
