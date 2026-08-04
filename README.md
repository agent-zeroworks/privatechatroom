# 🐱 Minx's Chatroom

A cozy chatroom built on Cloudflare Workers + Durable Objects.
**Main focus: the public room.** Private rooms are tucked to the side.

## Structure

```
├── wrangler.toml        # Cloudflare configuration
├── package.json
├── src/
│   ├── index.js         # Worker — routes, serves frontend, WebSocket upgrade
│   ├── frontend.js      # The whole client page (String.raw — safe from escaping bugs)
│   ├── chatroom.js      # Durable Object — room state, broadcast, history, lifecycle
│   └── config.js        # Shared constants (PUBLIC_ROOM, CODE_RE)
└── scripts/
    └── check-frontend.mjs  # Syntax-checks the client script before shipping
```

## How it works

- **`/`** — the public room (`CATCAFE8`). No code, everyone lands here.
  The public room never dies; history persists.
- **`/private`** — private room landing. Create a room (random 8-char code)
  or join one by code. Tucked behind a small link on the public page.
- **`/room/<code>`** — a private room. Share the code or link.
  When everyone who was in it has closed it, the room is erased and the code dies.
- **`/chat?room=<code>&username=<name>`** — WebSocket endpoint.

## Local development

```bash
npm install
npm run check     # sanity-check the embedded client script (run before every deploy)
npm run dev       # wrangler dev — local server with DO + SQLite
```

## Deploy

```bash
npm run deploy    # needs a Cloudflare API token with Workers Scripts: Edit
```

Or paste `src/index.js`, `src/chatroom.js`, `src/config.js`, `src/frontend.js`
into the Cloudflare dashboard worker editor and deploy.

**Always run `npm run check` before deploying** — it catches client-side
syntax errors that would otherwise ship as a dead page.
