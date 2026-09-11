import {createStarryNight, all} from "@wooorm/starry-night";
// Resolves into the package's lang/ directory -- its exports map is
// `"./*": "./lang/*.js"`, so the specifier carries neither prefix nor
// extension.
import sourceJsRegexp from "@wooorm/starry-night/source.js.regexp";
import {toHtml} from "hast-util-to-html";

import {loadCfmlGrammars} from "../grammars/cfml.js";
import {patchStockGrammars} from "../grammars/stock.js";
import {resolveScope} from "./resolve.js";

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

var ESCAPES = {"&": "&amp;", "<": "&lt;", ">": "&gt;"};

/**
* Two reasons this returns highlighted:false -- no grammar matched the flag, or
* some line exceeded MAX_LINE_LENGTH. Both are normal outcomes, not errors, and
* both produce the identical response shape.
*
* @param {string} code   Raw source. Never trusted.
* @param {string} flag   Fence tag, e.g. 'cfml'.
* @returns {{html: string, highlighted: boolean, scope: string|null}}
*/
export function highlight(code, flag) {
	var source = normalize(code);
	var scope = resolveScope(starryNight, flag, source);

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
		scope
	};
}

/**
* @param {object} config   loadConfig() output; only maxLineLength is read.
*/
export async function init(config) {
	maxLineLength = config.maxLineLength;

	// Patched BEFORE createStarryNight() rather than re-registered after it, so
	// nothing depends on register()'s replace-on-same-scope behaviour or on when
	// the registry loads a grammar. The stock module objects are shared
	// singletons; patchStockGrammars() clones what it touches.
	starryNight = await createStarryNight(patchStockGrammars(all));

	// After the stock set. These declare their own scope names, so this ADDS
	// `embedding.cfml` and `embedding.cfml.cfs` rather than replacing Linguist's
	// CFML grammars -- which is why every CFML tag has to be redirected in
	// `flagOverrides` (core/resolve.js), and why nothing else in the archive can
	// be affected by the swap.
	//
	// `boot()` calls missingScopes() straight after this. These grammars inline
	// everything and declare no dependencies, so it should stay empty; if it ever
	// does not, a patch has introduced an include that is not registered.
	var grammars = await loadCfmlGrammars();

	// source.js.regexp ships in the starry-night package but is absent from
	// `all` (nothing in Linguist maps a language to it), and source.js reaches
	// it through a raw include WITHOUT declaring it as a dependency -- so
	// missingScopes() cannot see the gap and boot() sails past it. The damage
	// is not a degraded include: vscode-textmate disables the ENTIRE rule whose
	// include cannot resolve, so with this grammar unregistered no JS regex
	// literal is recognized at all -- `/[0-9A-F]/` parses as division and
	// array math, and `9A` lands on invalid.illegal.identifier (pl-ii, white
	// on red). Measured 2026-08-31 by tokenizing with and without a stub.
	//
	// Its `names` and `extensions` ship empty, so registering it cannot make
	// any fence tag resolve here -- the same isolation the CFML grammars above
	// get by having their lists emptied at load.
	await starryNight.register([...grammars, sourceJsRegexp]);

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
		scope: null
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
