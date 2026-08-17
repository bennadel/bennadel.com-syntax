import {boot, handleRequest} from "../core/api.js";

/**
* Boot at module scope, which on Lambda means it lands in the INIT phase rather
* than inside a request. INIT gets a CPU burst and its own 10 s budget separate
* from the function timeout, so this is the right place for the ~2.3 s of import
* plus createStarryNight -- and it is paid once per execution environment, not
* once per invocation.
*
* boot() throws on a missing token or unmet grammar scopes. There is no process
* to exit here, so the throw stands: it fails INIT, and the message lands in
* CloudWatch Logs. Note that it surfaces as an INIT timeout rather than as the
* message itself, so read the lines ABOVE the timeout when debugging.
*/
await boot();

/**
* Function URL handler, payload format 2.0.
*
* Deliberately thin, and it must stay that way. Auth, routing, size checks, JSON
* parsing, input validation, and the highlight call all belong in
* ../core/api.js, shared with server.js. That is what makes the identical
* contract across both adapters a checked property rather than a promise;
* test/contract.test.js drives both and diffs the results.
*
* What remains here is the only thing that is genuinely Lambda-shaped: pulling
* method, path, and headers out of the event envelope, and rendering the result
* back into the response object Lambda expects.
*
* @param {object} event   Function URL event, payload format 2.0.
* @returns {Promise<{statusCode: number, headers: object, body: string}>}
*/
export async function handler(event) {
	// Lambda base64-encodes bodies it classifies as binary. For application/json
	// it normally does not, but the flag is authoritative and honouring it costs
	// nothing.
	//
	// Do not add a Content-Length pre-check here. It saves nothing -- Lambda has
	// already buffered the whole body by this point -- and rejecting on a
	// *declared* length lets a lying header refuse a perfectly small payload.
	// api.js measures the actual bytes instead.
	var body = event.isBase64Encoded
		? Buffer.from(event.body ?? "", "base64").toString("utf8")
		: (event.body ?? "");

	// Do not make these accesses optional. Payload format 2.0 always carries
	// rawPath, headers, and requestContext.http.method -- guarding them would be
	// claiming a doubt that does not exist. It also costs something real: format
	// 1.0 spells these `httpMethod` and `path`, so if this function were ever
	// handed a 1.0 event, `?.` would resolve the whole chain to undefined and
	// every request would 404 with a plausible-looking body. Unguarded, the same
	// mistake throws a TypeError on the line below, which says what is wrong.
	var {status, payload} = await handleRequest({
		method: event.requestContext.http.method,
		path: event.rawPath,
		// Header names in payload format 2.0 are lowercased by Lambda, so no
		// case-insensitive lookup is needed. An absent header is undefined, which
		// tokenMatches rejects -- that is the 401 path, not a missing-data case.
		token: event.headers["x-highlight-token"],
		body
	});

	return send(status, payload);
}

function send(status, payload) {
	return {
		statusCode: status,
		headers: {"content-type": "application/json; charset=utf-8"},
		body: JSON.stringify(payload)
	};
}
