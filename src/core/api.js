import {timingSafeEqual} from "node:crypto";

import {loadConfig} from "./config.js";
import {init, highlight} from "./highlight.js";

/**
* Transport-neutral request handling: auth, routing, validation, and the call
* into core/highlight.js.
*
* The layering, which is the directory structure rather than a convention:
*
*   src/core/highlight.js       pure highlighting, no I/O concepts at all
*   src/core/config.js          every env var, parsed and validated once
*   src/core/api.js             this file -- requests, but not transports
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
* takes a description of a request and returns a status, the response headers,
* and the final body string; the adapters write all three verbatim. The
* serialization happens here because it is contract -- which content-type a
* status carries, and which metadata headers ride on a 200, must not be able to
* diverge between adapters. test/contract.test.js drives both and asserts they
* agree byte for byte.
*/

// Module state: assigned by boot(), read by handleRequest and tokenMatches.
var config;

/**
* Startup checks shared by both adapters. Throws; the caller decides whether
* that means process.exit (container) or a failed INIT (Lambda).
*
* Order matters. loadConfig() and the token check run BEFORE init() so a
* misconfigured process dies immediately rather than spending ~2.3 s compiling
* grammars it must never use.
*
* On the token: do NOT add a permissive fallback for an unset one. Treating "no
* token configured" as "allow everything" is reasonable on a laptop and
* catastrophic behind a public Function URL, and from inside the process those
* two situations are indistinguishable -- what it produces is an open
* highlighting service with a healthy /health check and no other signal. That
* shipped once here, and only a deliberate unauthenticated probe caught it.
* The check lives here rather than in loadConfig() because tools/ and the
* corpus test run the highlighting core tokenlessly on purpose -- an empty
* token is fatal only to the thing that serves requests.
*
* On the scopes: grammar dependencies resolve silently when unmet --
* source.cfscript depends on source.sql, and a missing dependency degrades
* highlighting rather than throwing. Failing at boot beats shipping quietly
* wrong output.
*
* @returns {Promise<object>} the initialized starry-night instance
*/
export async function boot() {
	config = loadConfig(process.env);

	if (!config.token) {
		throw new Error("HIGHLIGHT_TOKEN is not set -- refusing to start");
	}

	var starryNight = await init(config);
	var missing = starryNight.missingScopes();

	if (missing.length > 0) {
		throw new Error(`Missing grammar scopes: ${missing.join(", ")}`);
	}

	return starryNight;
}

/**
* Handle one request.
*
* `body` arrives fully read, which means it is read before auth. Acceptable in
* both places this runs: Lambda has already buffered the whole body before the
* handler is invoked, and server.js only faces local development traffic.
*
* @param {object} request
* @param {string} request.method
* @param {string} request.path
* @param {string|null} request.language   ?language= query value, null when absent
* @param {string|undefined} request.token   x-highlight-token header, if any
* @param {string} request.body   raw code text, empty string when absent
* @returns {Promise<{status: number, headers: object, body: string}>}
*/
export async function handleRequest({method, path, language, token, body}) {
	// Unauthenticated, and reveals nothing beyond liveness. Serves the container
	// healthcheck locally, and is the target for a keep-warm ping on Lambda.
	if (method === "GET" && path === "/health") {
		return jsonResponse(200, {ok: true});
	}

	if (path !== "/highlight") {
		return jsonResponse(404, {error: "Not found"});
	}

	if (method !== "POST") {
		return jsonResponse(405, {error: "Method not allowed"});
	}

	if (!tokenMatches(token)) {
		return jsonResponse(401, {error: "Unauthorized"});
	}

	// Authoritative, unlike a declared Content-Length, which can lie or be
	// absent.
	if (Buffer.byteLength(body, "utf8") > config.maxBytes) {
		return jsonResponse(413, {error: "Payload too large"});
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
		var result = highlight(body, language);

		// x-scope is emitted even when nothing resolved -- an empty value
		// rather than an absent header, so a client reads it unconditionally.
		return {
			status: 200,
			headers: {
				"content-type": "text/html; charset=utf-8",
				"x-highlighted": String(result.highlighted),
				"x-scope": result.scope ?? ""
			},
			body: result.html
		};
	} catch (error) {
		console.error(error);

		return jsonResponse(500, {error: error.message});
	}
}

/**
* Every non-200 speaks JSON; only a successful highlight returns HTML. Header
* names are lowercase everywhere so the two adapters emit identical bytes.
*/
function jsonResponse(status, payload) {
	return {
		status,
		headers: {"content-type": "application/json; charset=utf-8"},
		body: JSON.stringify(payload)
	};
}

/**
* Constant-time comparison, so a caller cannot learn the token one byte at a
* time by measuring response latency. Length is compared first because
* timingSafeEqual throws on mismatched lengths -- that leaks token length, which
* is not worth defending.
*
* The token is guaranteed non-empty by boot(), so there is no "unconfigured"
* branch to fall open through.
*/
function tokenMatches(supplied) {
	if (typeof supplied !== "string") return false;

	var a = Buffer.from(supplied);
	var b = Buffer.from(config.token);

	return a.length === b.length && timingSafeEqual(a, b);
}
