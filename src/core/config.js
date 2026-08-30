/**
* Every environment variable the service reads, parsed and validated in one
* place, as a function over a plain object rather than over process.env itself.
*
* The function-over-env shape is load-bearing, not ceremony. A module-scope
* `Number(process.env.X)` bakes the value in at import time, and the ES module
* cache means nothing can ever re-evaluate it -- the only way to exercise such
* parsing against a different value is to spawn a whole new node process.
* Passed in, the env is just an argument: test/corpus.test.js drives the
* failure matrix with plain objects, in-process. Do not parse an env var
* anywhere else; add it here, so every consumer sees the same parse and the
* same default.
*
* The token is parsed here but its presence is deliberately not enforced here:
* tools/server.js and test/corpus.test.js run without one, because they import
* the highlighting core directly and hold no credential. An empty token is
* fatal only to the thing that serves requests, so boot() in api.js owns that
* refusal.
*/
export function loadConfig(env) {
	var config = {
		// Shared secret compared against the x-highlight-token header. Empty
		// means unset.
		token: env.HIGHLIGHT_TOKEN ?? "",

		// Payload cap (256 KB), enforced by handleRequest on the actual bytes.
		maxBytes: Number(env.MAX_BYTES ?? 262144),

		// ReDoS guard threshold -- the guard in highlight() explains why line
		// length is the dimension that matters. 2000 is sized from both ends: a
		// human-written line stays under it, including a prose paragraph inside
		// an HTML block left unwrapped on one line, while minified bundles and
		// base64 data URIs run to many thousands, so the junk still gets refused.
		// Do not reach for VS Code's equivalent default
		// (`editor.maxTokenizationLineLength`, 20,000): the per-line cost is
		// quadratic -- ~20ms per 2000-char line in the densest grammars
		// (minified JS, measured 2026-08-30) -- and at 20,000 a payload of
		// MAX_BYTES of such lines extrapolates past the Lambda timeout.
		// Env-overridable so a backfill can be re-run at a different limit
		// without rebuilding the image.
		maxLineLength: Number(env.MAX_LINE_LENGTH ?? 2000)
	};

	assertPositiveInt("MAX_BYTES", config.maxBytes);
	assertPositiveInt("MAX_LINE_LENGTH", config.maxLineLength);

	return config;
}

/**
* Reject a numeric config value that is not a positive integer, naming the
* variable so the message points straight at the env var to fix.
*
* NaN is the case that matters: a garbled value like "2OO" parses to NaN, every
* guard using these values is a `>` comparison, and `n > NaN` is always false
* -- so an unvalidated typo silently turns the payload cap and the ReDoS guard
* off at once, leaving exactly the open service the token check guards against.
*/
function assertPositiveInt(name, value) {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${name} must be a positive integer; check the ${name} env var (got ${value})`);
	}
}
