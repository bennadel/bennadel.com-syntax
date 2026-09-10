/**
* Adapter contract test.
*
* The API contract must be identical against both adapters, and this is what
* holds that up. Both adapters must stay thin: auth, routing, the payload cap,
* response serialization, and the highlight call belong in src/core/api.js.
* Moving any of it back into one adapter produces a divergence nothing else
* would catch -- it surfaces only as the ColdFusion client behaving differently
* against prod than against local, which is close to the worst place to find
* it.
*
* So this asserts three separate things per case:
*
*   1. Each adapter returns the expected status.
*   2. Both adapters return the SAME status, the SAME body, and the SAME
*      contract headers (content-type, x-highlighted, x-scope). Transport
*      headers -- date, content-length, connection -- are deliberately not
*      compared.
*   3. Where a case pins them, the coarse header expectations hold:
*      x-highlighted exactly, and only whether x-scope is empty, never its
*      value.
*
* The second is the one worth having. It turns "identical contract" from a
* claim into a checked property.
*
* NOT the golden corpus -- test/corpus.test.js targets src/core/highlight.js and
* verifies highlighting OUTPUT. This verifies the request/response envelope and
* deliberately keeps its assertions coarse, so that changing a grammar does not
* fail a transport test.
*
* Lives in test/ rather than beside the code because the deployment zip copies
* src/ wholesale -- see the header in test/corpus.test.js. Reachable locally
* because docker-compose.yaml bind-mounts test/ into the test services.
*
*   ./scripts/test.sh
*/

var TOKEN = "contract-test-token";
var PORT = 3999;

// Must be set BEFORE importing either adapter: both read process.env at module
// scope, and both now refuse to start without a token.
process.env.HIGHLIGHT_TOKEN = TOKEN;
process.env.PORT = String(PORT);

var {handler} = await import("../src/adapters/lambda.js");
var {loadConfig} = await import("../src/core/config.js");
await import("../src/adapters/server.js");

// server.js calls listen() at module scope; give it a moment to bind.
await new Promise((resolve) => setTimeout(resolve, 300));

// Sized via the same parse the service uses, rather than re-deriving the
// defaults here where they could drift.
var MAX_BYTES = loadConfig(process.env).maxBytes;
var MAX_LINE_LENGTH = loadConfig(process.env).maxLineLength;

// Request fields: `query` is the raw query string WITHOUT the leading `?`,
// kept separate from `path` because the two adapters receive it differently --
// callServer appends it to the URL, callLambda hands it to the event as
// rawQueryString, which Lambda never folds into rawPath. `contentType` exists
// only to prove the contract ignores it; fetch cannot send a string body
// without one.
//
// Expectation fields, both optional: `highlighted` pins the x-highlighted
// value exactly; `resolved` pins only whether x-scope is empty. Neither
// ever pins the resolved value itself -- a grammar change must not fail a
// transport test.
var cases = [
	// Routing and method handling.
	{name: "GET /health", status: 200,
		request: {method: "GET", path: "/health"}},
	{name: "GET /unknown-path", status: 404,
		request: {method: "GET", path: "/nope"}},
	{name: "GET /highlight (wrong method)", status: 405,
		request: {method: "GET", path: "/highlight"}},

	// Auth. The 401 cases are the regression guard for the fail-open bug.
	{name: "no token header", status: 401,
		request: {method: "POST", path: "/highlight", body: "x"}},
	{name: "wrong token", status: 401,
		request: {method: "POST", path: "/highlight", token: "nope", body: "x"}},
	{name: "token of different length", status: 401,
		request: {method: "POST", path: "/highlight", token: "a", body: "x"}},

	// Payload cap, measured on the actual code bytes.
	{name: "body over MAX_BYTES", status: 413,
		request: {method: "POST", path: "/highlight", token: TOKEN,
			body: "x".repeat(MAX_BYTES + 1024)}},

	// Highlighting outcomes.
	{name: "valid cfml", status: 200, highlighted: "true", resolved: true,
		request: {method: "POST", path: "/highlight", query: "language=cfml",
			token: TOKEN, body: "<cfset a = 1>"}},
	{name: "unknown language", status: 200, highlighted: "false", resolved: false,
		request: {method: "POST", path: "/highlight", query: "language=not-a-language",
			token: TOKEN, body: "x = 1"}},
	{name: "no language param", status: 200, highlighted: "false", resolved: false,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: "x = 1"}},
	{name: "empty language value", status: 200, highlighted: "false", resolved: false,
		request: {method: "POST", path: "/highlight", query: "language=",
			token: TOKEN, body: "x = 1"}},
	{name: "empty body", status: 200,
		request: {method: "POST", path: "/highlight", query: "language=cfml",
			token: TOKEN, body: ""}},
	{name: "line over MAX_LINE_LENGTH", status: 200, highlighted: "false",
		request: {method: "POST", path: "/highlight", query: "language=cfml",
			token: TOKEN, body: "a".repeat(MAX_LINE_LENGTH + 1)}},

	// Query-string decoding. Both adapters must run the same parser --
	// lambda.js goes through URLSearchParams for exactly this agreement.
	{name: "percent-encoded language", status: 200, highlighted: "true", resolved: true,
		request: {method: "POST", path: "/highlight", query: "language=c%66ml",
			token: TOKEN, body: "<cfset a = 1>"}},
	{name: "plus decodes to a space", status: 200, highlighted: "false", resolved: false,
		request: {method: "POST", path: "/highlight", query: "language=cf+ml",
			token: TOKEN, body: "x = 1"}},
	{name: "duplicate language, first wins", status: 200, highlighted: "true", resolved: true,
		request: {method: "POST", path: "/highlight", query: "language=cfml&language=xml",
			token: TOKEN, body: "<cfset a = 1>"}},
	{name: "unrelated params ignored", status: 200, highlighted: "true", resolved: true,
		request: {method: "POST", path: "/highlight", query: "foo=bar&language=cfml",
			token: TOKEN, body: "<cfset a = 1>"}},

	// The body is code, never an envelope. A payload that happens to be
	// well-formed JSON -- declared as such, even -- is highlighted as the
	// literal text it is.
	{name: "JSON-shaped body is literal code", status: 200, highlighted: "false", resolved: false,
		request: {method: "POST", path: "/highlight", contentType: "application/json",
			token: TOKEN, body: "{\"code\":\"x\",\"language\":\"cfml\"}"}},
	{name: "malformed-JSON-shaped body too", status: 200, highlighted: "false", resolved: false,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: "{nope"}}
];

var failures = 0;

console.log("");
console.log("case".padEnd(34), "lambda".padEnd(8), "server".padEnd(8), "match", "expected");
console.log("-".repeat(80));

for (var {name, request, status, highlighted, resolved} of cases) {
	var lambda = await callLambda(request);
	var server = await callServer(request);

	var match = lambda.status === server.status
		&& lambda.body === server.body
		&& lambda.headers["content-type"] === server.headers["content-type"]
		&& lambda.headers["x-highlighted"] === server.headers["x-highlighted"]
		&& lambda.headers["x-scope"] === server.headers["x-scope"];
	var expected = lambda.status === status && server.status === status;

	// Checked against one adapter only -- `match` already covers the other.
	var headersOk = true;

	if (highlighted !== undefined) {
		headersOk = headersOk && lambda.headers["x-highlighted"] === highlighted;
	}

	if (resolved !== undefined) {
		headersOk = headersOk && (lambda.headers["x-scope"] !== "") === resolved;
	}

	var ok = match && expected && headersOk;

	if (!ok) failures++;

	console.log(
		name.padEnd(34),
		String(lambda.status).padEnd(8),
		String(server.status).padEnd(8),
		(match && headersOk ? "yes" : "NO").padEnd(6),
		expected ? String(status) : `WANTED ${status}`
	);

	// Only dump details when something is wrong -- a passing run stays readable.
	if (!match || !headersOk) {
		console.log("   lambda:", JSON.stringify(lambda.headers), lambda.body.slice(0, 200));
		console.log("   server:", JSON.stringify(server.headers), server.body.slice(0, 200));
	}
}

console.log("-".repeat(80));
console.log(failures === 0
	? `PASS -- ${cases.length} cases, both adapters agree`
	: `FAIL -- ${failures} of ${cases.length} cases`);
console.log("");

process.exit(failures === 0 ? 0 : 1);

/**
* Drive the Lambda adapter directly. Builds a payload-format-2.0 event by hand
* rather than mocking, because the shape of that event IS part of what this
* test is pinning down.
*/
async function callLambda({method, path, query, token, body, contentType}) {
	var headers = {};

	if (token !== undefined) headers["x-highlight-token"] = token;
	if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));
	if (contentType !== undefined) headers["content-type"] = contentType;

	var result = await handler({
		rawPath: path,
		rawQueryString: query ?? "",
		requestContext: {http: {method}},
		headers,
		body
	});

	return {
		status: result.statusCode,
		headers: contractHeaders((name) => result.headers[name]),
		body: result.body
	};
}

/**
* Drive the HTTP adapter over a real socket. Not an in-process call: the whole
* point is that the transport is exercised.
*/
async function callServer({method, path, query, token, body, contentType}) {
	// A content-type is always sent (fetch will not send a string body without
	// one), and one case overrides it -- the contract ignores the header, and
	// varying it is how that stays proven.
	var headers = {"content-type": contentType ?? "text/plain"};

	if (token !== undefined) headers["x-highlight-token"] = token;

	var url = `http://127.0.0.1:${PORT}${path}${query ? `?${query}` : ""}`;

	try {
		var response = await fetch(url, {method, headers, body});
		var responseBody = await response.text();

		return {
			status: response.status,
			headers: contractHeaders((name) => response.headers.get(name)),
			body: responseBody
		};
	} catch (error) {
		// Surface transport failures as data rather than letting them abort
		// the run.
		return {status: "FETCH_FAILED", headers: contractHeaders(() => null), body: error.message};
	}
}

/**
* Pluck the contract headers through an adapter-specific reader (a plain
* object for lambda, a Fetch Headers for the server), normalizing "absent" to
* null on both sides so the parity comparison is a plain equality.
*/
function contractHeaders(read) {
	return {
		"content-type": read("content-type") ?? null,
		"x-highlighted": read("x-highlighted") ?? null,
		"x-scope": read("x-scope") ?? null
	};
}
