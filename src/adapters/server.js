import {createServer} from "node:http";

import {boot, handleRequest} from "../core/service.js";

var PORT = Number(process.env.PORT ?? 3000);

/**
* Deliberately thin. Auth, routing, validation, and the highlight call all live
* in ../core/service.js, shared with lambda.js -- see the note there on why
* that file exists. What remains here is node:http-specific: buffering the body
* and writing the response.
*
* This is the development adapter; lambda.js is the one that faces the
* internet. Do not add transport-level defenses here (a mid-stream size guard,
* a Content-Length pre-check) on the strength of "what if it were exposed" --
* it never is, and service.js already enforces the payload cap on the actual
* bytes for both adapters.
*
* This serves JSON and nothing else. Do not add a route that renders HTML: this
* stays an API rather than a mix of API and page rendering. Looking at
* highlighted output is what tools/ is for, and asserting it is correct is what
* test/corpus.test.js is for -- neither job belongs in an adapter.
*/
// Boot before creating the server, mirroring lambda.js, where boot is the
// first thing the module does. Throws on a missing token or unmet grammar
// scopes. Exiting rather than letting it propagate, because a non-zero exit is
// already meaningful to Docker and Compose -- and because the message is more
// useful than a stack trace.
try {
	var starryNight = await boot();
} catch (error) {
	console.error(error.message);
	process.exit(1);
}

var server = createServer(async (request, response) => {
	// llhttp accepts request-targets that are not valid URLs (`//%25`, `//[`),
	// and `new URL` throws on them. Unguarded, that rejection is unhandled and
	// Node kills the process -- a pre-auth crash from one malformed line. Lambda
	// never sees this: its Function URL hands service.js an already-parsed path.
	try {
		var url = new URL(request.url, "http://localhost");
	} catch {
		send(response, 400, {error: "Bad request"});

		return;
	}

	// readBody is passed as a function, not a string: service.js calls it only
	// after authorization passes, so an unauthenticated caller still cannot push
	// a payload before being refused.
	var {status, payload} = await handleRequest({
		method: request.method,
		path: url.pathname,
		token: request.headers["x-highlight-token"],
		readBody: () => readBody(request)
	});

	send(response, status, payload);
});

server.listen(PORT, () => {
	console.log(`listening on ${PORT}, ${starryNight.scopes().length} grammars`);
});

process.on("SIGTERM", () => {
	server.close(() => process.exit(0));
});

/**
* Buffer the request body and return the raw string, letting service.js do the
* parsing and the size check -- JSON and the payload cap are contract concerns,
* not transport ones.
*/
function readBody(request) {
	return new Promise((resolve, reject) => {
		var chunks = [];

		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		request.on("error", reject);
	});
}

function send(response, status, payload) {
	var body = JSON.stringify(payload);

	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"content-length": Buffer.byteLength(body)
	});
	response.end(body);
}
