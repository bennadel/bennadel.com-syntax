/**
* Pulls the code blocks out of a live bennadel.com post so they can be run
* through highlight() and looked at.
*
* WHAT THIS IS FOR
*
* The fixture corpus is a hand-picked sample. The archive is thousands of posts.
* This closes that gap without checking anything in: paste a URL, see what the
* service would do to every block in it. It is how you find the tag you have
* never seen, the block that trips MAX_LINE_LENGTH, and the grammar that looks
* fine on a fixture and wrong on real prose-embedded code.
*
* It is NOT a test and nothing it finds is asserted anywhere. When it turns up
* something worth keeping, the move is to add a fixture in test/__fixtures__/,
* which is what corpus.test.js actually holds the line on.
*
* WHY IT PARSES WITH REGEXES INSTEAD OF A DOM
*
* There is no HTML parser in the dependency tree, and adding one would put it in
* function.zip: node_modules is baked into the image from package.json, so a
* dependency taken for this page ships to Lambda. Not worth it for markup this
* narrow. The blog is template-generated, the shape is fixed, and the two
* variants below are the whole vocabulary:
*
*   <div data-gist-filename="x.cfm" class="code">
*    <pre><code class="language-cfm">ESCAPED SOURCE</code></pre>   <- post body
*
*   <pre><code class="language-sql">ESCAPED SOURCE</code></pre>    <- comments
*
* The usual objection to regex-parsing HTML -- that the closing tag can appear
* inside the content -- does not apply, because the content is entity-escaped.
* A literal `</code>` in the source is stored as `&lt;/code&gt;` and cannot end
* the match early. If the blog template ever changes, this finds zero blocks and
* says so, which is a visible failure rather than a subtly wrong one.
*
* Blocks WITHOUT a language class are ignored on purpose -- those are prose
* `<pre>` samples and inline `<code>` spans, which the real pipeline would not
* highlight either.
*/

/**
* Fetching an arbitrary URL server-side is a request-forgery primitive: this
* process sits inside a Docker network and would happily fetch 169.254.169.254
* or another container by name if asked. It has one job, so it is pinned to one
* host. The page is loopback-only already; this is the second lock, not the
* first.
*/
var ALLOWED = new Set(["www.bennadel.com", "bennadel.com"]);

/**
* Sent because the blog 403s some clients by User-Agent -- `Python-urllib` is
* rejected, Node's default is not, which is luck rather than a guarantee. An
* explicit, honest one also means this traffic is identifiable in the access
* log as a local tool rather than an unknown scraper.
*/
var AGENT = "bennadel-syntax-tools/1.0 (local inspection tool)";

var BLOCK = /<pre>\s*<code class="language-([^"]+)">([\s\S]*?)<\/code>\s*<\/pre>/g;

/** The wrapper div that carries the filename, searched for behind each match. */
var FILENAME = /data-gist-filename="([^"]+)"/g;

/**
* Comments are separated rather than dropped, because they are real archive
* content that the same pipeline has to highlight -- but they are other
* people's code, often pasted from elsewhere, and they would otherwise be
* indistinguishable from Ben's own blocks on the page. The boundary is the
* first comment article's id; a post with no comments has none, and everything
* counts as body.
*/
var COMMENT_START = /id="comments_\d+"/;

/**
* Single pass, which is what makes it correct: decoding `&lt;` and `&amp;` in
* separate passes turns the stored text `&amp;lt;` into `<` instead of `&lt;`.
* One replace with one alternation cannot double-decode.
*
* Only the entities the blog actually emits are named (`&lt;`, `&gt;`, `&amp;`
* were the only ones found across a 17-post sample), plus the two other named
* forms an HTML escaper might reasonably produce and the numeric forms.
*/
var ENTITIES = {
	"&lt;": "<",
	"&gt;": ">",
	"&amp;": "&",
	"&quot;": "\"",
	"&apos;": "'",
	"&nbsp;": " "
};

/**
* @returns {Promise<{url: URL, title: string|null, blocks: Array, commentCount: number}>}
*/
export async function fetchBlocks(input, {includeComments = false} = {}) {
	var url = normalizeUrl(input);

	var response = await fetch(url, {
		headers: {"user-agent": AGENT, accept: "text/html"},
		// Without this a hung connection hangs the page with no explanation. 15s
		// is long for a static page and short enough to read as "it is stuck".
		signal: AbortSignal.timeout(15_000),
		redirect: "follow"
	});

	if (!response.ok) {
		throw new Error(`${url.href} returned ${response.status} ${response.statusText}`);
	}

	var html = await response.text();

	var titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	var title = titleMatch ? decodeEntities(titleMatch[1]).trim() : null;

	var boundaryMatch = html.match(COMMENT_START);
	var boundary = boundaryMatch ? boundaryMatch.index : Infinity;

	var blocks = [];
	var commentCount = 0;

	BLOCK.lastIndex = 0;

	for (var match = BLOCK.exec(html); match; match = BLOCK.exec(html)) {
		var [, flag, escaped] = match;
		var isComment = match.index > boundary;

		if (isComment) commentCount++;
		if (isComment && !includeComments) continue;

		// Look backwards a short way for the wrapper div's filename. Bounded
		// deliberately: an unbounded search would happily attach the filename from
		// a block three paragraphs up once the template changes.
		var preceding = html.slice(Math.max(0, match.index - 300), match.index);
		var names = [...preceding.matchAll(FILENAME)];
		var filename = names.length ? names[names.length - 1][1] : null;

		blocks.push({
			flag,
			filename,
			isComment,
			source: decodeEntities(escaped)
		});
	}

	return {url, title, blocks, commentCount};
}

/**
* Accepts what someone would realistically paste or type: a full URL, a
* scheme-less host, or just the path.
*/
export function normalizeUrl(input) {
	var trimmed = String(input).trim();

	if (!trimmed) throw new Error("No URL given.");

	var withScheme = /^https?:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed.replace(/^\/*/, "www.bennadel.com/")}`;

	try {
		var url = new URL(withScheme);
	} catch {
		throw new Error(`Not a URL: ${trimmed}`);
	}

	if (!ALLOWED.has(url.hostname)) {
		throw new Error(
			`Refused ${url.hostname}. This tool only fetches ${[...ALLOWED].join(" or ")} ` +
			"-- it runs server-side inside a Docker network, so it is not a general proxy."
		);
	}

	// Downgrading to http would be a silent change to what was asked for.
	url.protocol = "https:";

	return url;
}

function decodeEntities(value) {
	return value.replace(/&(?:[a-z]+|#\d+|#x[0-9a-f]+);/gi, (entity) => {
		var named = ENTITIES[entity.toLowerCase()];

		if (named !== undefined) return named;

		var numeric = /^&#x/i.test(entity)
			? Number.parseInt(entity.slice(3, -1), 16)
			: Number.parseInt(entity.slice(2, -1), 10);

		// An entity this does not know is left verbatim rather than dropped. It
		// would show up in the rendered block as `&hellip;`, which is legible as
		// "the extractor missed one" -- silently deleting it would not be.
		return Number.isNaN(numeric) ? entity : String.fromCodePoint(numeric);
	});
}
