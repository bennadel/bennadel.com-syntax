/**
* A local inspection tool. NOT part of the deployed service, and NOT a test.
*
* WHAT THIS IS FOR
*
* Two pages, both rendering through highlight() with GitHub's own stylesheet so
* the output can be LOOKED AT:
*
*   /       every fixture in test/__fixtures__/
*   /blog   the code blocks pulled out of a live bennadel.com post
*
* That matters for the work no assertion can do for you: judging whether a
* candidate grammar is an improvement, seeing what an unfamiliar fence tag
* resolves to, and reading a `test-update` diff with some idea of what it will
* actually change on the page.
*
* /blog is the half that earns its keep. The fixture corpus is 14 hand-picked
* files against an archive of ~4,900 posts, and /blog is the only
* thing here that meets real prose-embedded code -- the tag nobody anticipated,
* the block that trips MAX_LINE_LENGTH, the grammar that looks right on a
* fixture and wrong in situ.
*
* WHAT THIS IS NOT
*
* It is not correctness coverage. A test fails on its own; a page requires a
* human to look at it and nod -- test/corpus.test.js is what actually holds the
* line, by asserting against golden files.
*
* This is a SEPARATE SERVICE so that the split stays intact: the API serves JSON
* and nothing else, and page rendering lives here, on its own port, in its own
* directory, never packaged. Do not add a rendering route to an adapter. The
* API's routing is a whitelist in src/core/service.js -- anything that is not
* /highlight or /health is 404 -- so a page route cannot appear there by
* accident, only on purpose.
*
* WHY IT CANNOT LEAK INTO THE DEPLOYMENT
*
* .dockerignore is an allow-list -- `*` denied, then src/ and the two manifests
* allowed back. `tools/` is never allowed, so it is not in the build context, not
* in the image, and not in function.zip. It reaches the container ONLY through
* the bind mount in docker-compose.yaml. Running the image without that mount
* fails with MODULE_NOT_FOUND, which is the correct failure: these tools are not
* supposed to be able to run from the image alone.
*
* WHY IT IMPORTS THE MODULE RATHER THAN CALLING THE API
*
* The HTTP surface already has 21 automated cases in test/contract.test.js, and a
* human clicking around adds nothing to them. Importing src/core/highlight.js
* directly means this needs no token and no running highlighter, so exposing
* this port exposes no API surface -- and any bug you see here is unambiguously
* a highlighting bug rather than a transport one.
*
* A RESTART IS REQUIRED AFTER EDITING src/.
*
* Node does not reload modules, so the process keeps whatever it imported at
* startup:
*
*   docker compose restart tools
*
* Fixtures are re-read on every request, so editing a .code or .html file shows
* up on refresh. Deliberately not using `node --watch`: file-change events do
* not reliably cross the Docker Desktop VM boundary on macOS, and a watch flag
* that silently fails to fire is worse than no watch flag at all.
*/

import {createServer} from 'node:http'
import {readdir, readFile} from 'node:fs/promises'

import {init, highlight, normalize, MAX_LINE_LENGTH, longestLine} from '../src/core/highlight.js'
import {fetchBlocks} from './blog.js'

const PORT = Number(process.env.PORT ?? 3001)

/**
* The live starry-night instance. Only the scope count is read, for the startup
* line; highlighting goes through src/core/highlight.js like everywhere else.
*/
let starryNight

const FIXTURES = new URL('../test/__fixtures__/', import.meta.url)

/**
* Resolved through the package exports map (`"./style/*": "./style/*.css"`)
* rather than a hardcoded node_modules path, so this page always shows the CSS
* belonging to the INSTALLED starry-night. If an upgrade changes the class
* vocabulary, this page reflects it without anyone remembering to re-copy a
* file.
*
* core.css  -- the .pl-* rules, written against CSS custom properties.
* both.css  -- the light and dark values for those properties, media-queried.
*
* Both are needed; core.css alone renders unstyled because every colour is a
* var() with nothing behind it.
*
* Note the subpath carries NO extension. The map is `"./style/*": "./style/*.css"`,
* so `style/core` is what resolves to core.css -- passing `style/core.css`
* resolves to `core.css.css`, and import.meta.resolve does not check that the
* file exists, so the mistake surfaces as a readFile ENOENT rather than here.
*/
const STYLE = ['core', 'both'].map((name) => ({
	name,
	url: new URL(import.meta.resolve(`@wooorm/starry-night/style/${name}`))
}))

/**
* The chrome every page here shares: colour tokens, typography, and the badge
* strip. Extracted when the third page arrived -- two near-identical copies was
* tolerable, three was not, and the pages had already started to drift apart in
* ways that were accidental rather than meant.
*
* Page width is a variable rather than a fixed rule because that is the one
* thing they genuinely disagree on: the fixture list is a reading column, the
* comparison is two code panels side by side.
*/
const BASE_CSS = `
	:root { color-scheme: light dark; --page: 62rem;
		--fg:#1f2328; --bg:#fff; --muted:#59636e; --line:#d1d9e0; --panel:#f6f8fa; }
	@media (prefers-color-scheme: dark) {
		:root { --fg:#f0f6fc; --bg:#0d1117; --muted:#9198a1; --line:#3d444d; --panel:#151b23; }
	}
	* { box-sizing: border-box; }
	body { margin:0 auto; padding:2rem 1.5rem 6rem; max-width:var(--page); background:var(--bg); color:var(--fg);
		font:14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
	h1 { font-size:1.5rem; margin:0 0 .25rem; }
	h2 { font-size:1rem; margin:0 0 .5rem; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
	h2 a { color:inherit; text-decoration:none; }
	h2 a:hover { text-decoration:underline; }
	h3 { font-size:.8rem; font-weight:600; color:var(--muted); margin:0 0 .4rem; }
	a { color:#0969da; }
	@media (prefers-color-scheme: dark) { a { color:#4493f8; } }
	.lede { color:var(--muted); margin:0 0 1.5rem; }
	.note { border:1px solid var(--line); border-left:3px solid var(--muted); background:var(--panel);
		padding:.75rem 1rem; border-radius:6px; margin:0 0 2rem; color:var(--muted); }
	.note strong { color:var(--fg); }
	section { border-top:1px solid var(--line); padding-top:1.75rem; margin-top:1.75rem; }
	.badges { margin:0 0 .75rem; display:flex; flex-wrap:wrap; gap:.4rem; }
	.badge { font-size:11px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
		border:1px solid var(--line); border-radius:999px; padding:.15rem .6rem; color:var(--muted); white-space:nowrap; }
	.badge b { color:var(--fg); font-weight:600; }
	.badge.ok b { color:#1a7f37; }
	.badge.warn b { color:#9a6700; }
	.badge.bad { border-color:#cf222e; }
	.badge.bad b { color:#cf222e; }
	@media (prefers-color-scheme: dark) {
		.badge.ok b { color:#3fb950; } .badge.warn b { color:#d29922; } .badge.bad b { color:#f85149; }
	}
	pre { overflow-x:auto; border-radius:6px; padding:1rem; margin:0; background:var(--panel); border:1px solid var(--line); }
	pre code { font:12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
	code { font-family:ui-monospace, SFMono-Regular, Menlo, monospace; }
`

const ESCAPES = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}

const server = createServer(async (request, response) => {
	const {pathname, searchParams} = new URL(request.url, 'http://localhost')

	try {
		const style = STYLE.find(({name}) => pathname === `/style/${name}.css`)

		if (style) {
			return send(response, 200, 'text/css; charset=utf-8',
				await readFile(style.url, 'utf8'))
		}

		if (pathname === '/') {
			return send(response, 200, 'text/html; charset=utf-8',
				page(await loadFixtures()))
		}

		// GET with the URL in the query string rather than a POST, so a result is
		// linkable and survives a refresh -- the whole workflow here is "look at
		// this post, change something in src/, restart, look again".
		if (pathname === '/blog') {
			const input = searchParams.get('url')
			const includeComments = searchParams.get('comments') === '1'

			// A failed fetch is an ordinary outcome of pasting a URL, not a crash:
			// it renders as a message above the form with the input still in it.
			// The catch-all below stays for genuine bugs, which is why this does
			// not swallow anything broader than the fetch.
			const [fetched, error] = input
				? await fetchBlocks(input, {includeComments})
					.then((value) => [value, null], (reason) => [null, reason.message])
				: [null, null]

			return send(response, 200, 'text/html; charset=utf-8',
				blogPage({input, includeComments, fetched, error}))
		}

		send(response, 404, 'text/plain; charset=utf-8', 'Not found\n')
	} catch (error) {
		// Shown rather than swallowed: this is a local tool, and the stack is the
		// most useful thing it can put on screen.
		send(response, 500, 'text/plain; charset=utf-8', `${error.stack}\n`)
	}
})

try {
	// Registers exactly what the service registers, and nothing more. Do not add
	// grammars here: a grammar set of its own is exactly how this page would come
	// to show output the service does not actually produce.
	starryNight = await init()

	server.listen(PORT, () => {
		console.log(`tools on ${PORT}, ${starryNight.scopes().length} grammars (/, /blog)`)
	})
} catch (error) {
	console.error(error.message)
	process.exit(1)
}

process.on('SIGTERM', () => {
	server.close(() => process.exit(0))
})

/**
* Same convention test/corpus.test.js reads: `<slug>.<language>.code`, where the
* language is the SECOND-TO-LAST dot segment so a slug may contain dots. Kept
* deliberately identical -- if the two ever disagree about what a fixture is
* named, the page would be inspecting something other than what the corpus
* asserts on, which is the one way this tool could actively mislead.
*/
async function loadFixtures() {
	const entries = (await readdir(FIXTURES))
		.filter((name) => name.endsWith('.code'))
		.sort()

	return Promise.all(entries.map(async (entry) => {
		const parts = entry.split('.')
		const language = parts[parts.length - 2]
		const goldenName = entry.replace(/\.code$/, '.html')

		const code = await readFile(new URL(entry, FIXTURES), 'utf8')

		// A fixture whose golden has not been generated yet is a normal state
		// mid-change, not an error worth crashing the page over.
		const golden = await readFile(new URL(goldenName, FIXTURES), 'utf8')
			.catch(() => null)

		const result = highlight(code, language)

		return {
			entry,
			goldenName,
			language,
			code,
			golden,
			result,
			lines: code.split('\n').length,
			// Reported, never enforced. The corpus test is what fails on drift;
			// this only tells you where to look when it does.
			drift: golden !== null && golden !== result.html
		}
	}))
}

function page(fixtures) {
	const drifting = fixtures.filter((fixture) => fixture.drift).length
	const plain = fixtures.filter((fixture) => !fixture.result.highlighted).length

	const toc = fixtures
		.map((fixture) => {
			const id = fixture.entry.replace(/[^a-z0-9]+/gi, '-')
			return `<li><a href="#${escapeHtml(id)}">${escapeHtml(fixture.entry)}</a></li>`
		})
		.join('\n\t\t\t')

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>syntax fixtures</title>
${STYLE.map(({name}) => `<link rel="stylesheet" href="/style/${name}.css">`).join('\n')}
<style>
${BASE_CSS}
	nav { border: 1px solid var(--line); border-radius: 6px; padding: 1rem 1rem 1rem 2.25rem; margin: 0 0 2rem; background: var(--panel); }
	nav ol { margin: 0; padding: 0; }
	nav li { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
	.drift { border: 1px solid #cf222e; border-radius: 6px; padding: .6rem .9rem; margin: 0 0 .75rem; font-size: 12px; }
	pre.markup { font-size: 11px; color: var(--muted); margin-top: .5rem; }
	details { margin-top: .75rem; }
	summary { cursor: pointer; color: var(--muted); font-size: 12px; user-select: none; }
</style>
</head>
<body>
<h1>syntax fixtures</h1>
<p class="lede">
	${fixtures.length} fixtures &middot; ${plain} rendered as plain text &middot;
	${drifting === 0 ? 'all goldens match' : `<strong>${drifting} differ from their golden</strong>`} &middot;
	MAX_LINE_LENGTH ${MAX_LINE_LENGTH} &middot;
	<a href="/blog">check a live post &rarr;</a>
</p>
<p class="note">
	<strong>This page is an inspection tool, not a test.</strong> Nothing here fails.
	<code>test/corpus.test.js</code> is what asserts these fixtures are correct; this only lets you
	see what it is asserting about. Rendered with GitHub's own stylesheet, shipped by
	<code>@wooorm/starry-night</code>, so colours match a real GitHub code block.
</p>
<nav>
	<ol>
		${toc}
	</ol>
</nav>
${fixtures.map(section).join('\n')}
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Live archive check (/blog)
// ---------------------------------------------------------------------------

function section(fixture) {
	const {entry, goldenName, language, result, lines, golden, drift} = fixture
	const id = entry.replace(/[^a-z0-9]+/gi, '-')

	const status = result.highlighted
		? badge('highlighted', 'yes', 'ok')
		: badge('highlighted', 'no -- plain text', 'warn')

	const resolved = badge('scope', result.resolvedLanguage ?? 'none', result.resolvedLanguage ? 'ok' : 'warn')

	const goldenBadge = golden === null
		? badge('golden', 'missing', 'warn')
		: drift
			? badge('golden', 'DIFFERS', 'bad')
			: badge('golden', 'matches', 'ok')

	return `
<section id="${escapeHtml(id)}">
	<h2><a href="#${escapeHtml(id)}">${escapeHtml(entry)}</a></h2>
	<p class="badges">
		${badge('flag', language, 'neutral')}
		${resolved}
		${status}
		${badge('lines', String(lines), 'neutral')}
		${goldenBadge}
	</p>
	${drift ? `<p class="drift">Live output differs from <code>${escapeHtml(goldenName)}</code>. Either the golden is stale (run <code>docker compose run --rm test-update</code> and read the diff) or highlighting has regressed. <code>test/corpus.test.js</code> is the authority, not this page.</p>` : ''}
	<pre class="render"><code>${result.html}</code></pre>
	<details>
		<summary>markup</summary>
		<pre class="markup"><code>${escapeHtml(result.html)}</code></pre>
	</details>
</section>`
}

function blogPage({input, includeComments, fetched, error}) {
	const form = `
<form method="get" action="/blog">
	<input type="url" name="url" value="${escapeHtml(input ?? '')}" placeholder="https://www.bennadel.com/blog/4661-..." autofocus>
	<label><input type="checkbox" name="comments" value="1"${includeComments ? ' checked' : ''}> include reader comments</label>
	<button type="submit">Highlight</button>
</form>`

	let body = ''

	if (error) {
		body = `<p class="error">${escapeHtml(error)}</p>`
	} else if (fetched) {
		const {url, title, blocks, commentCount} = fetched

		const skipped = includeComments ? 0 : commentCount

		body = `
<p class="lede">
	<a href="${escapeHtml(url.href)}">${escapeHtml(title ?? url.href)}</a><br>
	${blocks.length} code block${blocks.length === 1 ? '' : 's'}
	${skipped ? `&middot; ${skipped} more in reader comments, not shown` : ''}
	&middot; flags: ${[...new Set(blocks.map((b) => b.flag))].map((f) => `<code>${escapeHtml(f)}</code>`).join(', ') || 'none'}
</p>
${blocks.length === 0 ? `<p class="note">No language-tagged code blocks. Usually that just means the post has none. If you know it has code, the blog template has changed and <code>tools/blog.js</code> needs updating &mdash; it matches <code>&lt;pre&gt;&lt;code class="language-*"&gt;</code>.</p>` : ''}
${blocks.map(blogSection).join('\n')}`
	}

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>archive check</title>
${STYLE.map(({name}) => `<link rel="stylesheet" href="/style/${name}.css">`).join('\n')}
<style>
${BASE_CSS}
	:root { --page: 72rem; }
	form { display:flex; flex-wrap:wrap; gap:.5rem; align-items:center; margin:0 0 1.5rem;
		border:1px solid var(--line); background:var(--panel); border-radius:6px; padding:1rem; }
	form input[type=url] { flex:1 1 26rem; min-width:0; font:13px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
		padding:.45rem .6rem; border:1px solid var(--line); border-radius:6px; background:var(--bg); color:var(--fg); }
	form label { font-size:12px; color:var(--muted); display:flex; align-items:center; gap:.35rem; }
	form button { font:600 13px/1 inherit; padding:.55rem 1rem; border-radius:6px; cursor:pointer;
		border:1px solid var(--line); background:var(--bg); color:var(--fg); }
	.error { border:1px solid #cf222e; border-radius:6px; padding:.75rem 1rem; margin:0 0 1.5rem; font-size:13px; }
	pre.markup { font-size:11px; color:var(--muted); margin-top:.5rem; }
	details { margin-top:.75rem; }
	summary { cursor:pointer; color:var(--muted); font-size:12px; user-select:none; }
</style>
</head>
<body>
<h1>archive check</h1>
<p class="lede"><a href="/">&larr; fixtures</a></p>
${form}
<p class="note">
	<strong>Fetches a live post and runs its code blocks through <code>highlight()</code>.</strong>
	The blog stores the raw source in the HTML and transcludes the highlighted Gist over it in the
	browser, so what you see here is what this service <em>would</em> have produced for the same block.
	Nothing is asserted and nothing is saved &mdash; when a block turns up something worth keeping,
	add it to <code>test/__fixtures__/</code>, which is where <code>corpus.test.js</code> can hold it.
</p>
${body}
</body>
</html>`
}

function blogSection(block, index) {
	const source = normalize(block.source)
	const result = highlight(source, block.flag)
	const longest = longestLine(source)
	const preserved = textPreserved(source, result.html)

	const label = block.filename ?? `block ${index}`

	return `
<section>
	<h2>${escapeHtml(label)}</h2>
	<p class="badges">
		${badge('flag', block.flag, 'neutral')}
		${badge('scope', result.resolvedLanguage ?? 'none', result.resolvedLanguage ? 'ok' : 'warn')}
		${result.highlighted
			? badge('highlighted', 'yes', 'ok')
			: badge('highlighted', 'NO -- plain text', 'bad')}
		${badge('lines', String(source.split('\n').length), 'neutral')}
		${badge('longest line', `${longest.length} / ${MAX_LINE_LENGTH}`,
			longest.length > MAX_LINE_LENGTH ? 'bad' : 'neutral')}
		${preserved
			? badge('text preserved', 'yes', 'ok')
			: badge('text preserved', 'NO -- ESCAPING BUG', 'bad')}
		${block.isComment ? badge('from', 'reader comment', 'warn') : ''}
	</p>
	<pre class="render"><code>${result.html}</code></pre>
	<details>
		<summary>source as extracted &middot; markup</summary>
		<pre class="markup"><code>${escapeHtml(source)}</code></pre>
		<pre class="markup"><code>${escapeHtml(result.html)}</code></pre>
	</details>
</section>`
}

/**
* Does the rendered markup still contain exactly the source text?
*
* This is the one assertion the page can make on its own. Every fixture has a
* golden file to compare against; an arbitrary archive post has nothing, so the
* only property checkable without a human is that highlighting is
* TEXT-PRESERVING -- strip the tags, undo the escaping, and you must be holding
* the input back again.
*
* It is a real check, not decoration. Escaping bugs are the failure mode that
* matters most here, because they are silent: a dropped `&` or a doubled `&amp;`
* renders as something plausible and corrupts the stored HTML permanently. That
* is also why `normalize()` is imported rather than reimplemented -- the
* comparison has to be against what highlight() was actually given.
*/
function textPreserved(source, html) {
	// Exactly the three entities src/core/highlight.js emits, via ESCAPES, and no
	// more.
	// Decoding a wider set would make this pass on output the service does not
	// actually produce, which is the opposite of what the check is for. Stripping
	// tags is safe for the same reason the extractor's regex is: a literal `<` in
	// the source is already `&lt;` by this point and cannot look like a tag.
	const text = html
		.replace(/<[^>]*>/g, '')
		.replace(/&(?:lt|gt|amp);/g, (entity) => ({'&lt;': '<', '&gt;': '>', '&amp;': '&'})[entity])

	return text === normalize(source)
}

function badge(label, value, tone) {
	return `<span class="badge ${tone}">${escapeHtml(label)} <b>${escapeHtml(value)}</b></span>`
}

function send(response, status, type, body) {
	response.writeHead(status, {
		'content-type': type,
		'content-length': Buffer.byteLength(body),
		// Fixtures are re-read per request; caching would defeat that.
		'cache-control': 'no-store'
	})
	response.end(body)
}

/**
* Local to these tools on purpose. src/core/highlight.js has its own escaper tuned to
* the entity form GitHub emits; this one also escapes quotes
* because it is used for attribute values, and the two should not be shared
* lest a change made for an inspection page alter the shipped output.
*/
function escapeHtml(value) {
	return String(value).replace(/[&<>"]/g, (character) => ESCAPES[character])
}
