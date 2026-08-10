// Minx's Chatroom — Cloudflare Worker
// Main focus: the public room (PUBLIC_ROOM code, never destroyed).
// Private rooms: every room is a Durable Object keyed by its 8-char code.
// Rooms stay open until every party closes them.

import { Chatroom } from './chatroom.js'
import { PUBLIC_ROOM, CODE_RE } from './config.js'
import { FRONTEND } from './frontend.js'

export default {
	async fetch(request, env) {
		const url = new URL(request.url)
		const path = url.pathname

		// Frontend: public room (main focus), private room landing, or a room page
		if (path === '/' || path === '/index.html') {
			return serveFrontend(env)
		}

		if (path === '/private') {
			return serveFrontend(env)
		}

		if (/^\/room\/[A-HJ-NP-Z2-9]{8}$/.test(path)) {
			return serveFrontend(env)
		}

		// WebSocket connection to a room
		if (path === '/chat') {
			return handleWebSocket(request, env)
		}

		// Health check
		if (path === '/health') {
			return new Response('ok', { status: 200 })
		}

		return new Response('Not found', { status: 404 })
	}
}

function serveFrontend(env) {
	// Dev worker tags the version badge with -dev so test builds are distinguishable.
	const tag = env.APP_ENV === 'dev' ? '-dev' : ''
	return new Response(FRONTEND.split('__APP_ENV_TAG__').join(tag), {
		headers: {
			'Content-Type': 'text/html;charset=UTF-8',
		}
	})
}

async function handleWebSocket(request, env) {
	const url = new URL(request.url)
	const username = url.searchParams.get('username') || 'Anonymous'
	const room = (url.searchParams.get('room') || '').toUpperCase()

	// Every room is a Durable Object keyed by its code
	if (!CODE_RE.test(room)) {
		return new Response('Bad room code', { status: 400 })
	}

	const id = env.CHATROOM.idFromName('room-' + room)
	const stub = env.CHATROOM.get(id)

	// Forward to the Durable Object for WebSocket upgrade
	return await stub.fetch(
		new Request('http://internal/websocket?room=' + encodeURIComponent(room) + '&username=' + encodeURIComponent(username), {
			headers: { 'Upgrade': 'websocket' }
		})
	)
}

// The Durable Object class must be exported from the entrypoint for the
// CHATROOM binding (wrangler.toml). Nothing else may be a named export.
export { Chatroom }