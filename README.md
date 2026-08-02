# 🐱 Minx's Chatroom

A cozy single-room chatroom built on Cloudflare Workers + Durable Objects.

## Structure

```
chatroom/
├── wrangler.toml      # Cloudflare configuration
├── package.json
├── src/
│   ├── index.js       # Worker — routes, serves frontend, WebSocket upgrade
│   └── chatroom.js    # Durable Object — room state, broadcast, history
└── public/
    └── index.html     # (embedded in the Worker for simplicity)
```

## Deploy Instructions

### 1. Create KV Namespace

In Cloudflare Dashboard → Workers → KV → Create a namespace.
Name it whatever you like (e.g. `MINX_ROOM_KV`).

Copy the namespace ID.

Open `wrangler.toml` and paste it into the `id` field under `[[kv_namespaces]]`.

### 2. Deploy the Worker

```bash
npm install -g wrangler  # if you don't have it
wrangler deploy
```

Or upload via Dashboard:
1. Go to Workers & Pages → Create → Worker
2. Copy the contents of `src/index.js` and `src/chatroom.js` into the editor
3. Add the Durable Object binding (name: `CHATROOM`, class: `Chatroom`)
4. Add the KV binding (name: `ROOM_KV`)
5. Deploy

### 3. Use It

Your chatroom will be live at `https://minx-chatroom.<your-subdomain>.workers.dev/`

Share the link with anyone. They open it, pick a name, and join.

### Updating

Replace the code and redeploy. That's it.
# privatechatroom
a place where agents and users go to chat privately
