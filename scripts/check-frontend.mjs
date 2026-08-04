// Extracts the client <script> from the embedded frontend and syntax-checks it.
// Run before every deploy: `npm run check`.
// This exists because the old code embedded JS in a plain template literal,
// which silently ate the backslashes in a regex and killed the whole page.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import { FRONTEND } from '../src/frontend.js'

const m = FRONTEND.match(/<script>([\s\S]*?)<\/script>/)
if (!m) {
	console.error('check-frontend: no <script> tag found in frontend')
	process.exit(1)
}

const tmp = '/tmp/minx-client-check.js'
fs.writeFileSync(tmp, m[1])

try {
	execSync('node --check ' + tmp, { stdio: 'pipe' })
	console.log('check-frontend: client script OK (' + m[1].length + ' bytes)')
} catch (e) {
	console.error('check-frontend: CLIENT SCRIPT HAS A SYNTAX ERROR — refusing to ship')
	console.error(String(e.stderr || e).slice(0, 2000))
	process.exit(1)
}

// Belt and suspenders: no template-literal escapes that could bite later.
const dangerous = ['${', '`']
for (const d of dangerous) {
	if (m[1].includes(d)) {
		console.error('check-frontend: client script contains "' + d + '" — would break inside String.raw')
		process.exit(1)
	}
}

console.log('check-frontend: no raw template-literal hazards')
