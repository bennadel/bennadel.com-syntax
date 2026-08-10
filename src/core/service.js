import {timingSafeEqual} from 'node:crypto'

import {init, highlight} from './highlight.js'

/**
* Transport-neutral request handling: auth, routing, validation, and the call
* into core/highlight.js.
*
* The layering, which is the directory structure rather than a convention:
*
*   src/core/highlight.js       pure highlighting, no I/O concepts at all
*   src/core/service.js         this file -- requests, but not transports
*   src/adapters/server.js      node:http adapter
*   src/adapters/lambda.js      Function URL adapter
*
* Dependencies point one way only: adapters import core, core imports nothing
* from adapters, and highlight.js imports neither. A `../adapters/` import
* appearing anywhere under core/ means the layering has been broken, and that
* is now visible in the import line itself rather than requiring someone to
* know the rule. src/grammars/ sits outside both -- it is vendored third-party
* data plus its loader, not our logic, and LICENSES/README.md tracks it as such.
*
* Why this exists: the API contract has to be identical against both adapters.
* Nothing about running two adapters guarantees that -- it holds only
* because every rule lives here, in one copy. Do not move a check into an
* adapter because it seems to belong there; the second copy is the one that
* rots, and the divergence surfaces only as the ColdFusion client behaving
* differently against production than against local, which is close to the worst
* possible place to find it.
*
* This file knows nothing about sockets, streams, or Lambda event shapes. It
* takes a description of a request and returns a status plus a payload; the
* adapters do the serializing. test/contract.test.js drives both and asserts they
* agree byte for byte.
*/

const TOKEN = process.env.HIGHLIGHT_TOKEN ?? ''

export const MAX_BYTES = Number(process.env.MAX_BYTES ?? 262144)

// One string, one place -- it has to stay in sync with the shape checks in
// handleRequest, and it is returned from more than one call site.
const BAD_SHAPE = 'Expected { code: string, language?: string }'

/**
* Startup checks shared by both adapters. Throws; the caller decides whether
* that means process.exit (container) or a failed INIT (Lambda).
*
* Order matters. The token check runs BEFORE init() so a misconfigured process
* dies immediately rather than spending ~2.3 s compiling grammars it must never
* use.
*
* On the token: do NOT add a permissive fallback for an unset one. Treating "no
* token configured" as "allow everything" is reasonable on a laptop and
* catastrophic behind a public Function URL, and from inside the process those
* two situations are indistinguishable -- what it produces is an open
* highlighting service with a healthy /health check and no other signal. That
* shipped once here, and only a deliberate unauthenticated probe caught it.
*
* On the scopes: grammar dependencies resolve silently when unmet --
* source.cfscript depends on source.sql, and a missing dependency degrades
* highlighting rather than throwing. Failing at boot beats shipping quietly
* wrong output.
*
* @returns {Promise<object>} the initialized starry-night instance
*/
export async function boot() {
	if (!TOKEN) {
		throw new Error('HIGHLIGHT_TOKEN is not set -- refusing to start')
	}

	const starryNight = await init()
	const missing = starryNight.missingScopes()

	if (missing.length > 0) {
		throw new Error(`Missing grammar scopes: ${missing.join(', ')}`)
	}

	return starryNight
}

/**
* Handle one request.
*
* `readBody` is a FUNCTION, not a string, and that is load-bearing. It is called
* only after authorization passes, which preserves the ordering server.js
* has always had: an unauthenticated caller must not be able to push MAX_BYTES
* of payload before being told no. Passing an already-assembled string here
* would have quietly turned a 401-then-read into a read-then-401.
*
* The adapters supply very different implementations -- Lambda hands back an
* already-buffered string, the HTTP server returns a promise over a stream that
* enforces the size cap mid-upload and rejects with a tagged error.
*
* @param {object} request
* @param {string} request.method
* @param {string} request.path
* @param {string|undefined} request.token   x-highlight-token header, if any
* @param {() => Promise<string>|string} request.readBody
* @returns {Promise<{status: number, payload: object}>}
*/
export async function handleRequest({method, path, token, readBody}) {
	// Unauthenticated, and reveals nothing beyond liveness. Serves the container
	// healthcheck locally, and is the target for a keep-warm ping on Lambda.
	if (method === 'GET' && path === '/health') {
		return {status: 200, payload: {ok: true}}
	}

	if (path !== '/highlight') {
		return {status: 404, payload: {error: 'Not found'}}
	}

	if (method !== 'POST') {
		return {status: 405, payload: {error: 'Method not allowed'}}
	}

	if (!tokenMatches(token)) {
		return {status: 401, payload: {error: 'Unauthorized'}}
	}

	let raw

	try {
		raw = await readBody()
	} catch (error) {
		// The node:http adapter's streaming guard throws a 413 tagged this way. Anything
		// untagged is a genuine transport failure.
		const status = error.status ?? 500

		if (status === 500) console.error(error)

		return {status, payload: {error: error.message}}
	}

	// Authoritative, unlike a declared Content-Length, which can lie or be
	// absent. The HTTP adapter has usually rejected long before this.
	if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
		return {status: 413, payload: {error: 'Payload too large'}}
	}

	let body

	try {
		body = JSON.parse(raw)
	} catch {
		return {status: 400, payload: {error: 'Invalid JSON'}}
	}

	// Parsing cleanly is not the same as being handed an object: `null`, `42`,
	// `"x"` and `[]` are all valid JSON documents. Establish it once here, so
	// every property read below is a plain access rather than a guarded one --
	// `null` is the case that would otherwise throw, since typeof null is
	// 'object'. An array falls through to the `code` check and fails there.
	if (body === null || typeof body !== 'object') {
		return {status: 400, payload: {error: BAD_SHAPE}}
	}

	if (typeof body.code !== 'string') {
		return {status: 400, payload: {error: BAD_SHAPE}}
	}

	// `language` needs the same check as `code`, for a less obvious reason:
	// resolveScope() calls String(language), which THROWS on an object with a
	// non-callable toString -- {"language":{"toString":1}} raises "Cannot convert
	// object to primitive value". Unvalidated, that let a caller trigger a 500,
	// the one status reserved for the service itself being broken.
	//
	// null and undefined pass deliberately. Both already mean "no language" and
	// yield highlighted:false, and a JSON client serializing an absent value as
	// null is ordinary. Rejecting it would break a working call for no gain.
	if (body.language != null && typeof body.language !== 'string') {
		return {status: 400, payload: {error: BAD_SHAPE}}
	}

	// An unknown language or an over-long line is NOT an error -- highlight()
	// returns escaped plain text with highlighted:false. Callers never branch.
	//
	// Nothing is awaited in the catch, deliberately. Shipping the error to an
	// external service would hold the response open for a network round trip on
	// every failure, and Lambda freezes the execution environment the moment the
	// handler resolves -- so such a report has to be awaited to survive at all.
	// console.error reaches CloudWatch Logs, and the runtime prefixes every line
	// with the request ID, so it joins to the REPORT line at no cost.
	//
	// Note what can never reach this block: a wedged regex burning CPU never
	// yields, so the event loop is blocked and the timeout arrives as SIGKILL,
	// which is uncatchable. That failure is only ever visible from outside the
	// process. See the MAX_LINE_LENGTH notes in core/highlight.js.
	try {
		return {status: 200, payload: highlight(body.code, body.language)}
	} catch (error) {
		console.error(error)

		return {status: 500, payload: {error: error.message}}
	}
}

/**
* Constant-time comparison, so a caller cannot learn the token one byte at a
* time by measuring response latency. Length is compared first because
* timingSafeEqual throws on mismatched lengths -- that leaks token length, which
* is not worth defending.
*
* TOKEN is guaranteed non-empty by boot(), so there is no "unconfigured" branch
* to fall open through.
*/
function tokenMatches(supplied) {
	if (typeof supplied !== 'string') return false

	const a = Buffer.from(supplied)
	const b = Buffer.from(TOKEN)

	return a.length === b.length && timingSafeEqual(a, b)
}
