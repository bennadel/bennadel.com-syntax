import {createServer} from 'node:http'

import {boot, handleRequest, MAX_BYTES} from '../core/service.js'

const PORT = Number(process.env.PORT ?? 3000)

function tooLarge() {
	return Object.assign(new Error('Payload too large'), {status: 413})
}

/**
* Read the request body, enforcing the payload cap DURING the stream rather than
* after. Buffering first and then checking the size would let a hostile caller
* push arbitrary bytes into memory before we reject them.
*
* This is the one piece of request handling that genuinely cannot move into
* ../core/service.js: it depends on the body arriving incrementally, and on Lambda
* there is no stream left to reject during. It returns the raw string and lets
* service.js do the parsing -- JSON is a contract concern, not a transport one.
*/
function readBody(request) {
	return new Promise((resolve, reject) => {
		// Cheap path: the client declared an oversized body, so reject before
		// reading a single byte. Chunked or dishonest requests fall through to
		// the streaming guard below.
		const declared = Number(request.headers['content-length'])

		if (Number.isFinite(declared) && declared > MAX_BYTES) {
			return reject(tooLarge())
		}

		let size = 0
		let rejected = false
		const chunks = []

		request.on('data', (chunk) => {
			if (rejected) return

			size += chunk.length

			if (size > MAX_BYTES) {
				// Deliberately NOT destroying the socket here. Doing so kills the
				// connection before the 413 can be written, and the caller sees a
				// connection reset instead of a structured error -- which every
				// one of our three callers would have to special case. Just stop
				// accumulating and let the handler respond.
				rejected = true
				chunks.length = 0

				return reject(tooLarge())
			}

			chunks.push(chunk)
		})

		request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
		request.on('error', reject)
	})
}

function send(response, status, payload, {close = false} = {}) {
	const body = JSON.stringify(payload)
	const headers = {
		'content-type': 'application/json; charset=utf-8',
		'content-length': Buffer.byteLength(body)
	}

	// Used when we reject a body mid-upload: the caller may still be sending,
	// and there is no point keeping the connection alive to receive bytes we
	// have already refused.
	if (close) headers.connection = 'close'

	response.writeHead(status, headers)
	response.end(body)
}

/**
* Deliberately thin. Auth, routing, validation, and the highlight call all live
* in ../core/service.js, shared with lambda.js -- see the note there on why
* that file exists. What remains here is node:http-specific: the streaming body
* guard and writing the response.
*
* This serves JSON and nothing else. Do not add a route that renders HTML: this
* stays an API rather than a mix of API and page rendering. Looking at
* highlighted output is what tools/ is for, and asserting it is correct is what
* test/corpus.test.js is for -- neither job belongs in an adapter.
*/
const server = createServer(async (request, response) => {
	const {pathname} = new URL(request.url, 'http://localhost')

	// readBody is passed as a function, not a string: service.js calls it only
	// after authorization passes, so an unauthenticated caller still cannot push
	// a payload before being refused.
	const {status, payload} = await handleRequest({
		method: request.method,
		path: pathname,
		token: request.headers['x-highlight-token'],
		readBody: () => readBody(request)
	})

	send(response, status, payload, {close: status === 413})

	// Only after the response has flushed -- otherwise we are back to handing the
	// caller a reset instead of the 413.
	if (status === 413) response.on('finish', () => request.destroy())
})

// Throws on a missing token or unmet grammar scopes. Exiting rather than
// letting it propagate, because a non-zero exit is already meaningful to Docker
// and Compose -- and because the message is more useful than a stack trace.
try {
	const starryNight = await boot()

	server.listen(PORT, () => {
		console.log(`listening on ${PORT}, ${starryNight.scopes().length} grammars`)
	})
} catch (error) {
	console.error(error.message)
	process.exit(1)
}

process.on('SIGTERM', () => {
	server.close(() => process.exit(0))
})
