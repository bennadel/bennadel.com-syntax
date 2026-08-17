import {createStarryNight, all} from "@wooorm/starry-night";
import {toHtml} from "hast-util-to-html";

import {loadCfmlGrammars, CFML_TAG, CFML_SCRIPT} from "../grammars/cfml.js";

var starryNight;

// Refuse to highlight a block containing a line longer than this. Set by
// init() from config rather than read from the environment here -- this module
// stays free of I/O concepts, env vars included; core/config.js owns the
// parsing and the default.
//
// This is the ReDoS guard, and line length is the right dimension because
// TextMate grammars tokenize line by line -- vscode-textmate hands one line at
// a time to Oniguruma, so cost scales with the longest line, not the payload.
// Worse, it re-scans for the earliest matching pattern at EVERY position in the
// line, so even a perfectly well-behaved linear regex is O(n^2) on line length
// before any backtracking pathology enters the picture. That quadratic term is
// the realistic failure mode; true exponential blowup needs a specific
// ambiguous pattern and only ~30 characters, so no input inspection can catch
// it -- Lambda's SIGKILL on timeout is the only thing that stops that case.
//
// Note this counts UTF-16 code units, not glyphs, so a line of CJK or emoji
// hits the limit sooner than its visible length suggests. Correct for the
// purpose: regex work tracks code units.
var maxLineLength;

// Local overrides layered on top of Linguist's alias set. Linguist already
// resolves the common cases ('js', 'cfm', 'cfml', 'bash'); this is only for
// conventions of our own, or mappings we disagree with.
// A value of `null` forces the plain-text path, which is a real and necessary
// override rather than a way of spelling "absent" -- see `txt` below.
var flagOverrides = new Map([
	// All three below were confirmed against a fence-tag scan of the archive on
	// 2026-08-04: each is a tag actually in use that resolved to nothing, so the
	// blocks were rendering as unhighlighted plain text.
	//
	// These point at a grammar, which means they only work while that grammar is
	// registered. Curation must keep all three targets checked -- and note that
	// curation cannot replace these entries, because it can add grammars but
	// cannot invent an alias.

	// EVERY CFML TAG IS OVERRIDDEN, INCLUDING THE ONES LINGUIST ALREADY RESOLVES.
	//
	// The CFML grammars are cfmleditor's, registered under
	// their own scope names (`embedding.cfml`, `embedding.cfml.cfs`) so they ADD
	// scopes rather than replacing Linguist's. Linguist's own `text.html.cfm` and
	// `source.cfscript` are therefore still registered and still reachable -- a
	// tag left un-overridden would silently keep using the 2013 grammar.
	//
	// That is why `cfm`, `cfml`, `coldfusion` and `coldfusion-cfc` appear here
	// even though they resolve upstream without help. They are not repairs; they
	// are the redirect. Adding a CFML tag means adding it here too.

	// Tag-based. `cfm` and `cfml` resolve upstream; `cf` is our own convention
	// and Linguist has never listed it.
	["cf", CFML_TAG],
	["cfm", CFML_TAG],
	["cfml", CFML_TAG],
	["coldfusion", CFML_TAG],

	// Script-based. `cfc` and `coldfusion-cfc` resolve upstream, to the file
	// extension's grammar; the rest are ours.
	//
	// `cfs` was NOT found in the archive scan -- it is a tag to write going
	// forward, not a repair to existing content. Nothing breaks if it goes
	// unused. `cfscript` was: it is the most obvious thing a commenter would
	// type and was the one spelling that rendered as plain text, because
	// Linguist reaches the grammar through the .cfc file extension rather than
	// by name.
	["cfs", CFML_SCRIPT],
	["cfscript", CFML_SCRIPT],
	["cfc", CFML_SCRIPT],
	["coldfusion-cfc", CFML_SCRIPT],

	// Same syntax as .gitignore, which already resolves to this scope.
	["dockerignore", "source.gitignore"],

	// Newline-delimited JSON -- every line is a JSON document, and there is no
	// separate grammar for the container format.
	["ndjson", "source.json"],

	// `conf` resolves to `source.ini` upstream, which is wrong twice over: the
	// archive's `conf` blocks are web-server configs, and INI syntax treats `;`
	// as a comment, so every nginx statement terminator rendered as `pl-c`.
	//
	// nginx over apacheconf by inspection, not inference: all 4 blocks using the
	// tag were read, and 3 are nginx (`upstream`, `log_format`, `location`)
	// against 1 Apache (`RewriteRule`).
	//
	// That one Apache block is the known cost, and it is small -- under this
	// grammar it renders nearly plain rather than acquiring false tokens, which
	// is the opposite of the `txt` case below and the reason this is an override
	// rather than a `null`. Retag it `apache` if it ever matters; the tag
	// already resolves to `source.apacheconf` on its own.
	//
	// INI itself is unaffected: `ini` is a separate tag in the archive and still
	// resolves to `source.ini` on its own.
	["conf", "source.nginx"],

	// `txt` resolves to `text.adblock` with the full grammar set loaded, and
	// adblock filter syntax treats a leading `!` as a comment and `||`/`^` as
	// operators. A plain-text block tagged `txt` therefore comes back with lines
	// wrapped in `pl-c`, which Primer renders grey and italic -- prose styled as
	// a comment and effectively hidden.
	//
	// `text` and `plain` need nothing -- no grammar means plain text, which is
	// already correct. `txt` is the exception, so it needs saying explicitly.
	//
	// Curation would also have fixed this by never registering the adblock
	// grammar, but curation was declined: a whitelist is wrong once
	// readers can submit code in languages the site owner never uses. Overrides
	// are the chosen instrument, and this is one.
	["txt", null]
]);

// Linguist's two spellings are listed alongside ours on purpose. Nothing routes
// to them today, but a future override that forgets to use the
// CFML_SCRIPT constant would otherwise lose the tag-vs-script correction
// silently, which is exactly the class of bug this file guards against.
var SCRIPT_SCOPES = new Set([CFML_SCRIPT, "source.cfscript", "source.cfscript.patched"]);

var ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;"};

/**
* Two reasons this returns highlighted:false -- no grammar matched the flag, or
* some line exceeded MAX_LINE_LENGTH. Both are normal outcomes, not errors, and
* both produce the identical response shape.
*
* @param {string} code   Raw source. Never trusted.
* @param {string} flag   Fence tag, e.g. 'cfml'.
* @returns {{html: string, highlighted: boolean, resolvedLanguage: string|null}}
*/
export function highlight(code, flag) {
	var source = normalize(code);
	var scope = refineScope(resolveScope(flag), source);

	// No grammar -> escaped plain text. Same shape as a successful response so
	// callers never branch; the flag is for logging, not control flow.
	if (!scope) return plain(source);

	// Checked AFTER resolving the scope purely so the log can name the grammar
	// that was skipped -- an unknown language has already returned above, so
	// this never runs on a block that was not going to be highlighted anyway.
	var longest = longestLine(source);

	if (longest.length > maxLineLength) {
		// Loud on purpose. A silent refusal means unhighlighted HTML gets stored
		// and the omission is discovered months later while reading the archive.
		// The caller knows which post or comment it is holding; this only has to
		// supply the reason it can pair with its own identifier.
		console.warn(
			`highlight: refused ${scope} -- line ${longest.number} is ` +
			`${longest.length} chars, limit ${maxLineLength}`
		);

		return plain(source);
	}

	var tree = starryNight.highlight(source, scope);
	var lines = splitLines(tree.children);

	// Rejoin with explicit newline text nodes. No wrapper element -- the caller
	// owns <pre><code>. Because nothing crosses a newline, the caller can also
	// split this string on \n later to add line numbers or anchors without ever
	// re-running the highlighter.
	var children = lines.flatMap((line, index) =>
		index === 0 ? line : [{type: "text", value: "\n"}, ...line]
	);

	return {
		html: toHtml(
			{type: "root", children: escapeTree(children)},
			{allowDangerousHtml: true}
		),
		highlighted: true,
		resolvedLanguage: scope
	};
}

/**
* @param {object} config   loadConfig() output; only maxLineLength is read.
*/
export async function init(config) {
	maxLineLength = config.maxLineLength;
	starryNight = await createStarryNight(all);

	// After the stock set. These declare their own scope names, so this ADDS
	// `embedding.cfml` and `embedding.cfml.cfs` rather than replacing Linguist's
	// CFML grammars -- which is why every CFML tag has to be redirected in
	// `flagOverrides` above, and why nothing else in the archive can be affected
	// by the swap.
	//
	// `boot()` calls missingScopes() straight after this. These grammars inline
	// everything and declare no dependencies, so it should stay empty; if it ever
	// does not, a patch has introduced an include that is not registered.
	var grammars = await loadCfmlGrammars();

	await starryNight.register(grammars);

	return starryNight;
}

/**
* Minimal, deliberate normalization. Anything done here is baked permanently
* into stored HTML, so this stays small:
*
*   - CRLF/CR -> LF, so the line split is deterministic no matter which OS the
*     code was pasted from.
*   - Drop ONE trailing newline, which otherwise renders as a phantom blank
*     final line inside <pre>.
*
* Deliberately NOT done: dedenting, tab expansion, trailing-space trimming.
* Those rewrite what a reader copies out, and they get subtle with mixed
* tabs/spaces. Tab width is a CSS concern (`tab-size`).
*/
export function normalize(code) {
	return String(code).replace(/\r\n?/g, "\n").replace(/\n$/, "");
}

/**
* Length of the longest line, and which line it is (1-based, for the log).
*
* Walks with indexOf rather than `source.split('\n')` for two reasons: split
* allocates a separate string for every line of a payload that may be 256 KB,
* and `Math.max(...lines)` on a spread of ~100k+ elements overflows the call
* stack. This is O(n) with no allocation.
*/
export function longestLine(source) {
	var longest = 0;
	var number = 1;
	var current = 1;
	var start = 0;

	for (;;) {
		var index = source.indexOf("\n", start);
		var length = (index === -1 ? source.length : index) - start;

		if (length > longest) {
			longest = length;
			number = current;
		}

		if (index === -1) return {length: longest, number};

		start = index + 1;
		current++;
	}
}

/**
* Resolve a fence tag to a TextMate scope.
* Overrides win; otherwise Linguist decides. Undefined means "no grammar",
* which is a normal outcome, not an error.
*/
function resolveScope(flag) {
	if (!flag) return undefined;
	var normalized = String(flag).trim().toLowerCase();
	if (!normalized) return undefined;

	// `has`, not `??`. A `null` override means "force plain text", and `??` would
	// treat it as absent and fall straight through to Linguist -- which is the
	// exact lookup the override exists to suppress.
	if (flagOverrides.has(normalized)) return flagOverrides.get(normalized) ?? undefined;

	return starryNight.flagToScope(normalized);
}

/**
* Adjust a resolved scope using the source itself.
*
* Only one rule, and it exists because a `.cfc` can be written either way:
* tag-based in older code, script-based in newer. Linguist maps the extension to
* `source.cfscript`, which renders script correctly and mangles tags -- angle
* brackets as `pl-k`, tag names as `pl-smi` instead of `pl-ent`.
*
* GitHub has the same behaviour, so this is a deliberate DIVERGENCE from parity
* rather than a bug fix. It is the exact case the project exists for: GitHub's
* CFML grammar is weak and permanently out of reach, and self-hosted it is just
* a file.
*
* This is TextMate's `firstLineMatch` idea -- pick the grammar by looking at the
* content -- implemented here instead of in a grammar, because starry-night
* resolves a flag to a scope without ever consulting the source, and we have the
* source in hand anyway. A custom grammar could not do it more cleanly: a
* grammar has one scopeName, so content-dependent dispatch would need a
* synthetic wrapper grammar for the same result.
*
* Applied to the scope, not the tag, so `cfc`, `cfs` and `cfscript` all benefit.
* Content wins over the tag's claim: source with tags at line starts is not
* script, whatever it was labelled.
*/
function refineScope(scope, source) {
	// Both spellings: the stock scope, and our patched wrapper around it. Listing
	// both means an override that forgets to point at the patched grammar still
	// gets the tag-vs-script correction rather than silently losing it.
	if (SCRIPT_SCOPES.has(scope) && looksTagBased(source)) return CFML_TAG;

	return scope;
}

/**
* Does this look like tag-based CFML rather than script?
*
* Anchored to the start of a line, which is what makes it safe. A bare
* /<cf[a-z]/ would fire on `var s = "<cfoutput>"` inside a script-based
* component, and a false positive is the expensive direction: `text.html.cfm`
* produces ZERO tokens for script-based source, so a wrong guess turns a
* correctly highlighted block into a plain one.
*
* Matching any `<cf...` tag rather than `<cfcomponent` specifically is
* deliberate. Twenty years of blog examples are mostly fragments -- a lone
* `<cffunction>` or `<cfset>` with no component wrapper -- and those are exactly
* as tag-based as a full file.
*/
function looksTagBased(source) {
	return /^[ \t]*<cf[a-z]/im.test(source);
}

/**
* The single degradation path: escaped plain text, in the same response shape
* as a success.
*
* Shared by both refusal reasons -- no grammar, and a line over the limit -- so
* a caller never grows a third case to handle. The distinction
* lives only in the log, deliberately: `markdownContent` is the source of truth
* and the drift policy is to re-highlight everything, so nothing downstream
* needs to tell the two apart.
*/
function plain(source) {
	return {
		// Direct, rather than a one-node toHtml call: with the escaping already
		// ours, routing it through the serializer would only be ceremony.
		html: escapeText(source),
		highlighted: false,
		resolvedLanguage: null
	};
}

/**
* Split a hast node list so that no element ever spans a newline.
*
* Recursive because tokens nest -- a pl-s string containing pl-pds delimiters
* that runs across three lines has to close and reopen BOTH elements on each
* line. Returns one array of nodes per line.
*/
function splitLines(nodes) {
	var lines = [[]];
	var push = (node) => lines[lines.length - 1].push(node);

	for (var node of nodes) {
		if (node.type === "text") {
			var parts = node.value.split(/\r?\n/);
			for (var [index, part] of parts.entries()) {
				if (index > 0) lines.push([]);
				if (part) push({type: "text", value: part});
			}
		} else {
			// Recurse, then re-wrap each resulting line in a clone of this element.
			for (var [index, childLine] of splitLines(node.children).entries()) {
				if (index > 0) lines.push([]);
				if (childLine.length) push({...node, children: childLine});
			}
		}
	}

	return lines;
}

/**
* Convert every text node to a pre-escaped `raw` node, recursively.
*
* Paired with `allowDangerousHtml: true`, which sounds worse than it is: that
* flag is read in exactly one place in hast-util-to-html -- the `raw` handler --
* so it changes nothing about how elements or attributes serialize. The only
* raw nodes in this tree are the ones created here, from text this function
* just escaped. starry-night's output contains element and text nodes only.
*/
function escapeTree(nodes) {
	return nodes.map((node) =>
		node.type === "text"
			? {type: "raw", value: escapeText(node.value)}
			: {...node, children: escapeTree(node.children)}
	);
}

/**
* Escape text content the way GitHub does, which is NOT the way
* hast-util-to-html does.
*
* Its text handler escapes only `<` and `&` -- correct per spec, since `>` is
* unambiguous in text content -- and emits hexadecimal references (`&#x3C;`)
* unless told otherwise. GitHub emits `&lt;`, `&gt;`, `&amp;`. Both parse to
* identical text, but the archive already holds twenty years of rows in
* GitHub's form, and matching it byte-for-byte keeps old and new output
* diffable instead of differing on every single line.
*
* This cannot be reached through options. `characterReferences` gets the named
* forms, but the handler hardcodes its subset and applies it AFTER spreading
* those options:
*
*   stringifyEntities(node.value, Object.assign({}, characterReferences, {
*     subset: ['<', '&']
*   }))
*
* -- so a `subset` passed in is silently discarded. Hence doing it here and
* handing toHtml `raw` nodes instead of `text` nodes.
*
* The three characters in ESCAPES are the complete set required for text
* content; quotes matter only inside attribute values, which toHtml still
* escapes itself. Order is irrelevant because `&` is replaced in the same pass
* rather than a prior one, so no replacement can be double-escaped.
*/
function escapeText(value) {
	return value.replace(/[&<>]/g, (character) => ESCAPES[character]);
}
