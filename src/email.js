// Shared email sender — used by the Worker (magic links) and the Durable
// Object (away-notification digests). One provider, two jobs.
//
// Provider: Resend (free tier: 3,000 emails/mo, 100/day). The key arrives
// as the RESEND_API_KEY secret. Until it exists, nothing is sent — calls
// log a dry-run line instead, so the whole pipeline is testable without
// a provider.
//
// Kind rules:
//   'magic'  — login links. Sent whenever a key exists; a failed send
//              falls back to inline display (login must never brick).
//   'notify' — away-digests. Gated by NOTIFY_ENABLED so the digest
//              machinery can ship inert and light up the day the flag flips.

import { NOTIFY_ENABLED, NOTIFY_FROM_NAME, NOTIFY_FROM_EMAIL } from './config.js'

export async function sendEmail(env, { to, subject, html, kind = 'magic' }) {
	const key = env.RESEND_API_KEY
	if (!key) {
		console.log(`[email] ${kind} dry-run → ${to} | ${subject}`)
		return false
	}
	if (kind === 'notify' && !NOTIFY_ENABLED) {
		console.log(`[email] notify dry-run (flag off) → ${to} | ${subject}`)
		return false
	}

	try {
		const res = await fetch('https://api.resend.com/emails', {
			method: 'POST',
			headers: {
				'Authorization': 'Bearer ' + key,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				from: `${NOTIFY_FROM_NAME} <${NOTIFY_FROM_EMAIL}>`,
				to: [to],
				subject,
				html
			})
		})
		if (!res.ok) {
			console.log(`[email] ${kind} failed (${res.status}):`, await res.text())
			return false
		}
		return true
	} catch (e) {
		console.log('[email] send threw:', String(e))
		return false
	}
}
