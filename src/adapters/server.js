import {createServer} from "node:http";

import {boot, handleRequest} from "../core/api.js";

var PORT = Number(process.env.PORT ?? 3000);

/**
* Deliberately thin. Auth, routing, validation, and the highlight call all live
* in ../core/api.js, shared with lambda.js -- see the note there on why
* that file exists. What remains here is node:http-specific: buffering the body
* and writing the response.
*
* This is the development adapter; lambda.js is the one that faces the
* internet. Do not add transport-level defenses here (a mid-stream size guard,
* a Content-Length pre-check) on the strength of "what if it were exposed" --
* it never is, and api.js already enforces the payload cap on the actual
* bytes for both adapters. The same goes for rescue try/catches around the
* handler: a malformed request line or a mid-read socket error crashes the
* process, and for a dev-only server a stack trace and a restart beat
* defensive plumbing.
*
* This serves the API and nothing else. Do not add a route that renders a page:
* this stays an API rather than a mix of API and page rendering. Looking at
* highlighted output is what tools/ is for, and asserting it is correct is what
* test/corpus.test.js is for -- neither job belongs in an adapter.
*/

// Boot before creating the server, mirroring lambda.js, where boot is the
// first thing the module does. Throws on a missing token or unmet grammar
// scopes, and the throw is deliberately uncaught: a top-level throw exits
// non-zero, which is all Docker and Compose need -- the same way an INIT
// failure surfaces on Lambda.
await boot();

var server = createServer(async (request, response) => {
	var url = new URL(request.url, "http://localhost");
	var body = await readBody(request);

	var {status, headers, body: responseBody} = await handleRequest({
		method: request.method,
		path: url.pathname,
		language: url.searchParams.get("language"),
		token: request.headers["x-highlight-token"],
		body
	});

	response.writeHead(status, {
		...headers,
		"content-length": Buffer.byteLength(responseBody)
	});
	response.end(responseBody);
});

server.listen(PORT, () => {
	console.log(`listening on ${PORT}`);
});

process.on("SIGTERM", () => {
	server.close(() => process.exit(0));
});

/**
* Buffer the request body and return the raw string, letting api.js do the
* size check -- the payload cap is a contract concern, not a transport one.
*/
function readBody(request) {
	return new Promise((resolve, reject) => {
		var chunks = [];

		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", reject);
	});
}
