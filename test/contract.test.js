/**
* Adapter contract test.
*
* The API contract must be identical against both adapters, and this is what
* holds that up. Both adapters must stay thin: auth, routing,
* validation, and the highlight call belong in src/core/api.js. Moving any
* of it back into one adapter produces a divergence nothing else would catch --
* it surfaces only as the ColdFusion client behaving differently against prod
* than against local, which is close to the worst place to find it.
*
* So this asserts two separate things per case:
*
*   1. Each adapter returns the expected status.
*   2. Both adapters return the SAME status and the SAME body.
*
* The second is the one worth having. It turns "identical contract" from a claim
* into a checked property.
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
// default here where it could drift.
var MAX_BYTES = loadConfig(process.env).maxBytes;

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
		request: {method: "POST", path: "/highlight", body: json({code: "x"})}},
	{name: "wrong token", status: 401,
		request: {method: "POST", path: "/highlight", token: "nope", body: json({code: "x"})}},
	{name: "token of different length", status: 401,
		request: {method: "POST", path: "/highlight", token: "a", body: json({code: "x"})}},

	// Body parsing.
	{name: "malformed JSON", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: "{nope"}},
	// Every one of these parses cleanly and is not an object. `null` is the one
	// that would throw rather than 400 if the shape checks read properties off
	// the parsed value directly.
	{name: "JSON null body", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: "null"}},
	{name: "JSON number body", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: "42"}},
	{name: "JSON string body", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: "\"x\""}},
	{name: "JSON array body", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: "[]"}},
	{name: "missing code", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: json({language: "cfml"})}},
	{name: "code is a number", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: json({code: 42})}},

	// language validation -- regression guard for the String() throw.
	{name: "language {toString:1}", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: json({code: "x", language: {toString: 1}})}},
	{name: "language {}", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: json({code: "x", language: {}})}},
	{name: "language []", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: json({code: "x", language: []})}},
	{name: "language 42", status: 400,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: json({code: "x", language: 42})}},
	{name: "language null (legal)", status: 200,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: json({code: "x", language: null})}},
	{name: "language absent (legal)", status: 200,
		request: {method: "POST", path: "/highlight", token: TOKEN, body: json({code: "x"})}},

	// Payload cap.
	{name: "body over MAX_BYTES", status: 413,
		request: {method: "POST", path: "/highlight", token: TOKEN,
			body: json({code: "x".repeat(MAX_BYTES + 1024)})}},

	// Highlighting outcomes. Coarse on purpose -- status and the highlighted
	// flag only, so grammar changes do not fail a transport test.
	{name: "valid cfml", status: 200,
		request: {method: "POST", path: "/highlight", token: TOKEN,
			body: json({code: "<cfset a = 1>", language: "cfml"})}},
	{name: "unknown language", status: 200,
		request: {method: "POST", path: "/highlight", token: TOKEN,
			body: json({code: "x = 1", language: "not-a-language"})}},
	{name: "empty code", status: 200,
		request: {method: "POST", path: "/highlight", token: TOKEN,
			body: json({code: "", language: "cfml"})}},
	{name: "line over MAX_LINE_LENGTH", status: 200,
		request: {method: "POST", path: "/highlight", token: TOKEN,
			body: json({code: "a".repeat(500), language: "cfml"})}}
];

var failures = 0;

console.log("");
console.log("case".padEnd(32), "lambda".padEnd(8), "server".padEnd(8), "match", "expected");
console.log("-".repeat(78));

for (var {name, request, status} of cases) {
	var lambda = await callLambda(request);
	var server = await callServer(request);

	var match = lambda.status === server.status && lambda.body === server.body;
	var expected = lambda.status === status && server.status === status;
	var ok = match && expected;

	if (!ok) failures++;

	console.log(
		name.padEnd(32),
		String(lambda.status).padEnd(8),
		String(server.status).padEnd(8),
		(match ? "yes" : "NO").padEnd(6),
		expected ? String(status) : `WANTED ${status}`
	);

	// Only dump bodies when something is wrong -- a passing run stays readable.
	if (!match) {
		console.log("   lambda body:", lambda.body.slice(0, 200));
		console.log("   server body:", server.body.slice(0, 200));
	}
}

console.log("-".repeat(78));
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
async function callLambda({method, path, token, body}) {
	var headers = {};

	if (token !== undefined) headers["x-highlight-token"] = token;
	if (body !== undefined) headers["content-length"] = String(Buffer.byteLength(body));

	var result = await handler({
		rawPath: path,
		requestContext: {http: {method}},
		headers,
		body
	});

	return {status: result.statusCode, body: result.body};
}

/**
* Drive the HTTP adapter over a real socket. Not an in-process call: the whole
* point is that the transport is exercised.
*/
async function callServer({method, path, token, body}) {
	var headers = {"content-type": "application/json"};

	if (token !== undefined) headers["x-highlight-token"] = token;

	try {
		var response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
			method,
			headers,
			body
		});

		var body = await response.text();

		return {status: response.status, body};
	} catch (error) {
		// Surface transport failures as data rather than letting them abort
		// the run.
		return {status: "FETCH_FAILED", body: error.message};
	}
}

// A function declaration rather than a const, so it can live down here: `cases`
// is built at module scope and calls this, which only works because the
// declaration hoists.
function json(value) {
	return JSON.stringify(value);
}
