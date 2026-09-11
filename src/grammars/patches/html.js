/**
* HTML patches. Two grammars carry HTML rules, both descended from the same
* html.tmbundle:
*
*   text.html.basic       starry-night's stock grammar, reached by `htm` and
*                         `html` fences and by every grammar that embeds HTML
*                         by scope name
*   embedding.cfml(.cfs)  cfmleditor's inlined copy of the HTML rules, in two
*                         repository contexts each: the general HTML-content
*                         entry and the copy used inside <cfoutput> blocks
*
*   bad-ampersand       a bare `&` in a URL or attribute value is not an error
*   bad-angle-bracket   `<`, `<=` and `<>` in a cfquery body are not errors
*   comment-hyphens     `--` inside an HTML comment is not an error
*   doctype-capture     the `<!DOCTYPE` keyword is highlighted
*
* The first two edit HTML rules that only the cfmleditor copy carries in a
* form that misfires; the stock grammar is not a carrier today.
*/

import {CFML_TAG, CFML_SCRIPT} from "../scopes.js";
import {count} from "./walk.js";

/**
* Bare `&` renders as invalid.illegal -> pl-ii, white on red.
*
* cfmleditor's character-reference rule set -- included in HTML text and
* attribute-value contexts -- tries the real entity forms first (`&name;`,
* `&#123;`, `&#xAB;`) and then ends with a catch-all that brands every
* remaining ampersand `invalid.illegal.bad-ampersand.html`. That is HTML4
* pedantry: `href="?a=1&b=2"` is legal HTML5 (`&b` names no entity, so there
* is no ambiguity), and the archive is twenty years of exactly that URL shape,
* so the strictness lights up ordinary attribute values as errors.
*
* It is also a divergence from the baseline this project matches: GitHub's
* `text.html.basic` renders the same snippet with no illegal token --
* measured on 2026-08-30 against the starry-night registration, not assumed
* from the old html.tmbundle it descends from.
*
* The patch deletes ONLY the catch-all. The entity rules stay, so `&rarr;`
* keeps its character-reference highlighting; a bare `&` is simply unclaimed
* and falls through to plain text, which is GitHub's rendering.
*/
var patchBadAmpersand = {
	name: "bad-ampersand",
	branches: new Map([
		[CFML_TAG, badAmpersandInCfml],
		[CFML_SCRIPT, badAmpersandInCfml]
	])
};

function badAmpersandInCfml(grammar) {
	// Both HTML-content contexts carry their own copy of the rule set: the
	// general one, and the copy used inside <cfoutput> blocks.
	var ENTRIES = [
		"text-html-cfml-character-reference",
		"text-html-cfml-cfoutput-character-reference"
	];

	var CATCH_ALL = "invalid.illegal.bad-ampersand.html";

	for (var entry of ENTRIES) {
		var patterns = grammar.repository[entry].patterns;

		var index = patterns.findIndex((p) => p.name === CATCH_ALL && p.match === "&");

		// Anchor check. If upstream drops the catch-all themselves, remove this
		// patch rather than leaving it to fail silently against nothing.
		if (index < 0) {
			throw new Error(`${grammar.scopeName}: ${entry} no longer carries the ${CATCH_ALL} catch-all; remove badAmpersandInCfml`);
		}

		patterns.splice(index, 1);
	}

	// The two entries above must be the ONLY carriers. A third copy appearing
	// elsewhere in an upstream update would survive this patch and put pl-ii
	// ampersands back in some context nobody re-tested -- fail loudly instead.
	// A string scan rather than a walk, so the scope is caught inside a
	// compound name or a regex too.
	if (JSON.stringify(grammar.repository).includes(CATCH_ALL)) {
		throw new Error(`${grammar.scopeName}: ${CATCH_ALL} now appears outside the two character-reference entries; extend badAmpersandInCfml to cover it`);
	}
}

/**
* A bare `<` in HTML text renders as invalid.illegal -> pl-ii.
*
* Both HTML-content contexts end with catch-alls branding any `<` that opened
* no tag illegal -- `<>` first, then every remaining `<`. In an HTML page that
* only fires on typos, but a cfquery body is SQL, where `<` and `<>` are
* comparison operators:
*
*   WHERE piv.id < 82
*   AND   date_started <= NOW()
*
* lights up white-on-red on every operator. Found by the SQL-tag pl-ii sweep
* (posts 1424 and 496; fixtures 1424-1.cfm, 1424-2.cfm, 496-1.cfm, 496-3.cfm).
* The `<>` case was confirmed by repro, not a fixture: SQL's not-equals hits
* it the same way. Measured before patching: real tags and cfscript
* comparisons take other rules and are unaffected.
*
* Like comment-hyphens, this DIVERGES from GitHub in spirit -- flagging stray
* `<` is defensible for a document that is only HTML -- but CFML pages carry
* query bodies as ordinary content, so the strictness misfires on the
* archive's most common construct. The trade: a genuinely stray `<` (an
* unclosed tag typo) now falls through to plain text instead of flagging.
* That reads as unstyled, which is how the rest of this project treats
* content it cannot classify.
*
* The patch deletes ONLY the two catch-alls. Every real tag form is claimed
* by earlier rules, so tags keep highlighting; only the leftover `<` and `<>`
* become unclaimed.
*/
var patchBadAngleBracket = {
	name: "bad-angle-bracket",
	branches: new Map([
		[CFML_TAG, badAngleBracketInCfml],
		[CFML_SCRIPT, badAngleBracketInCfml]
	])
};

function badAngleBracketInCfml(grammar) {
	// Both HTML-content contexts carry their own copy of the pair: the general
	// one, and the copy used inside <cfoutput> blocks.
	var ENTRIES = [
		"text-html-cfml",
		"text-html-cfml-cfoutput"
	];

	var CATCH_ALLS = new Map([
		["invalid.illegal.incomplete.html", "<>"],
		["invalid.illegal.bad-angle-bracket.html", "<"]
	]);

	for (var entry of ENTRIES) {
		var patterns = grammar.repository[entry].patterns;

		for (var [name, match] of CATCH_ALLS) {
			var index = patterns.findIndex((p) => p.name === name && p.match === match);

			// Anchor check. If upstream drops a catch-all themselves, shrink this
			// patch rather than leaving it to fail silently against nothing.
			if (index < 0) {
				throw new Error(`${grammar.scopeName}: ${entry} no longer carries the ${name} catch-all; shrink badAngleBracketInCfml`);
			}

			patterns.splice(index, 1);
		}
	}

	// The two entries above must be the ONLY carriers. A third copy appearing
	// elsewhere in an upstream update would survive this patch and put pl-ii
	// operators back in some context nobody re-tested -- fail loudly instead.
	// A string scan rather than a walk, so the scope is caught inside a
	// compound name or a regex too.
	for (var scope of CATCH_ALLS.keys()) {
		if (JSON.stringify(grammar.repository).includes(scope)) {
			throw new Error(`${grammar.scopeName}: ${scope} now appears outside the two HTML-content entries; extend badAngleBracketInCfml to cover it`);
		}
	}
}

/**
* `--` inside an HTML comment renders as invalid.illegal -> pl-ii.
*
* The comment rule in every carrier ends with a catch-all that brands `--`
* before the closing `-->` illegal. That outlaws the archive's own house
* style, the hyphen-run divider comment:
*
*   <!-- ------- -->
*
* which lights up white-on-red in the middle of ordinary markup. HTML5 permits
* `--` inside comment text -- only `<!--`, `-->`, and `--!>` are reserved --
* so the strictness is SGML-era pedantry against input that is now legal.
* Found by the JavaScript-tag pl-ii sweep (posts 1740, 3540 and 2811;
* fixtures 1740-1.cfm, 3540-2.htm and 2811-1.htm).
*
* Unlike bad-ampersand, this DIVERGES from GitHub rather than restoring it:
* GitHub's text.html.basic carries the same catch-all (with a lookahead that
* spares only the closing run), so GitHub renders these dividers as errors
* too. Do not "fix" this patch to match GitHub -- the divergence is the point,
* and it is the same trade adopting cfmleditor made: correct beats parity.
*
* Each branch deletes ONLY the catch-all. Everything else the comment rule
* includes stays -- the tag include in the cfmleditor copy, so CFML inside an
* HTML comment keeps highlighting; `#embedded-code` in the stock grammar, so
* anything it embeds in comments keeps working. An inner `--` is simply
* unclaimed and falls through to the enclosing comment scope, rendering as
* comment text.
*/
var patchCommentHyphens = {
	name: "comment-hyphens",
	branches: new Map([
		["text.html.basic", commentHyphensInHtml],
		[CFML_TAG, commentHyphensInCfml],
		[CFML_SCRIPT, commentHyphensInCfml]
	])
};

function commentHyphensInHtml(grammar) {
	var CATCH_ALL = "invalid.illegal.bad-comments-or-CDATA.html";

	// The comment rule lives in the grammar's top-level patterns, not the
	// repository. Keyed on name AND begin so the SGML rule (`<!` ... `>`),
	// which legitimately shares the scope NAME, cannot be mistaken for it.
	var comments = grammar.patterns.filter((p) => p.name === "comment.block.html" && p.begin === "<!--");

	if (comments.length !== 1) {
		throw new Error(`${grammar.scopeName}: no longer carries exactly one top-level comment.block.html rule; re-derive commentHyphensInHtml`);
	}

	// The stock catch-all is `--` plus a lookahead sparing the closing run,
	// so the match is tested by its opening rather than whole.
	var isCatchAll = (p) => p.name === CATCH_ALL && typeof p.match === "string" && p.match.startsWith("--");

	var index = comments[0].patterns.findIndex(isCatchAll);

	// Anchor check. If upstream drops the catch-all themselves, remove this
	// patch rather than leaving it to fail silently against nothing.
	if (index < 0) {
		throw new Error(`${grammar.scopeName}: the comment rule no longer carries the ${CATCH_ALL} catch-all; remove commentHyphensInHtml`);
	}

	comments[0].patterns.splice(index, 1);

	// The comment rule must be the ONLY carrier of a `--`-shaped catch-all.
	// One appearing elsewhere in a starry-night upgrade would survive this
	// patch and put pl-ii dividers back in some context nobody re-tested --
	// fail loudly instead.
	if (count(grammar, isCatchAll) > 0) {
		throw new Error(`${grammar.scopeName}: a \`--\` ${CATCH_ALL} rule now appears outside the top-level comment rule; extend commentHyphensInHtml to cover it`);
	}
}

function commentHyphensInCfml(grammar) {
	// Both HTML-content contexts carry their own copy of the comment rule: the
	// general one, and the copy used inside <cfoutput> blocks.
	var ENTRIES = [
		"text-html-cfml",
		"text-html-cfml-cfoutput"
	];

	var CATCH_ALL = "invalid.illegal.bad-comments-or-CDATA.html";

	var isCatchAll = (p) => p.name === CATCH_ALL && p.match === "--";

	for (var entry of ENTRIES) {
		var patterns = grammar.repository[entry].patterns;

		var comments = patterns.filter((p) => p.name === "comment.block.html" && p.begin === "<!--");

		if (comments.length !== 1) {
			throw new Error(`${grammar.scopeName}: ${entry} no longer carries exactly one comment.block.html rule; re-derive commentHyphensInCfml`);
		}

		var index = comments[0].patterns.findIndex(isCatchAll);

		// Anchor check. If upstream drops the catch-all themselves, remove this
		// patch rather than leaving it to fail silently against nothing.
		if (index < 0) {
			throw new Error(`${grammar.scopeName}: the ${entry} comment rule no longer carries the ${CATCH_ALL} catch-all; remove commentHyphensInCfml`);
		}

		comments[0].patterns.splice(index, 1);
	}

	// The two entries above must be the ONLY carriers of the bare-`--` form. The
	// SGML rule (`<!` ... `>`) legitimately keeps the same scope NAME on a
	// different match, so full absence cannot be asserted the way bad-ampersand
	// asserts it; the exact rule shape is counted instead. A third comment
	// context appearing in an upstream update would survive this patch and put
	// pl-ii dividers back somewhere nobody re-tested -- fail loudly instead.
	if (count(grammar.repository, isCatchAll) > 0) {
		throw new Error(`${grammar.scopeName}: a bare-\`--\` ${CATCH_ALL} rule now appears outside the two HTML-content entries; extend commentHyphensInCfml to cover it`);
	}
}

/**
* `<!DOCTYPE` renders with no scope on the keyword.
*
* Both grammars descend from the same html.tmbundle SGML rule, dead capture
* included. Its doctype sub-rule assigns entity.name.tag.doctype.html to
* CAPTURE GROUP 1 of a begin regex that has no capture group -- `(?i:...)` is
* non-capturing -- so the scope lands on nothing and the keyword falls
* through as plain text. The DTD strings beside it have a working rule, which
* is what makes the gap read as deliberate: the strings light up and the
* keyword does not.
*
* The patch wraps the begin in the parentheses upstream forgot, which is the
* whole fix: group 1 now exists and upstream's own captures entry applies.
* This is not a new claim, it is the rule's stated intent completed.
*
* GitHub renders the keyword plain too -- its text.html.basic ships the same
* dead rule -- so the output diverges from GitHub the way comment-hyphens
* does: correct beats parity.
*/
var patchDoctypeCapture = {
	name: "doctype-capture",
	branches: new Map([
		["text.html.basic", doctypeCaptureInHtml],
		[CFML_TAG, doctypeCaptureInCfml],
		[CFML_SCRIPT, doctypeCaptureInCfml]
	])
};

function doctypeCaptureInHtml(grammar) {
	var BROKEN = "(?i:DOCTYPE)";

	// The SGML rule lives in the grammar's top-level patterns, like the comment
	// rule commentHyphensInHtml anchors on.
	var sgml = grammar.patterns.filter((p) => p.name === "meta.tag.sgml.html" && p.begin === "<!");

	if (sgml.length !== 1) {
		throw new Error(`${grammar.scopeName}: no longer carries exactly one top-level meta.tag.sgml.html rule; re-derive doctypeCaptureInHtml`);
	}

	var doctypes = sgml[0].patterns.filter((p) => p.name === "meta.tag.sgml.doctype.html");

	// Anchor check on the exact broken shape. If upstream fixes the capture
	// themselves, remove this patch rather than double-wrapping their regex.
	if (
		doctypes.length !== 1
		|| doctypes[0].begin !== BROKEN
		|| JSON.stringify(doctypes[0].captures) !== JSON.stringify({1: {name: "entity.name.tag.doctype.html"}})
	) {
		throw new Error(`${grammar.scopeName}: the doctype rule no longer has the broken no-capture shape; remove or re-derive doctypeCaptureInHtml`);
	}

	doctypes[0].begin = `(${BROKEN})`;

	// The SGML rule must be the ONLY carrier of the broken shape. One appearing
	// elsewhere in a starry-night upgrade would survive this patch and keep a
	// plain doctype in some context nobody re-tested -- fail loudly instead.
	if (count(grammar, (node) => node.name === "meta.tag.sgml.doctype.html" && node.begin === BROKEN) > 0) {
		throw new Error(`${grammar.scopeName}: a no-capture doctype rule now appears outside the top-level SGML rule; extend doctypeCaptureInHtml to cover it`);
	}
}

function doctypeCaptureInCfml(grammar) {
	// Both HTML-content contexts carry their own copy of the SGML rule: the
	// general one, and the copy used inside <cfoutput> blocks.
	var ENTRIES = [
		"text-html-cfml",
		"text-html-cfml-cfoutput"
	];

	var BROKEN = "(?i:DOCTYPE)";

	for (var entry of ENTRIES) {
		var patterns = grammar.repository[entry].patterns;

		var sgml = patterns.filter((p) => p.name === "meta.tag.sgml.html" && p.begin === "<!");

		if (sgml.length !== 1) {
			throw new Error(`${grammar.scopeName}: ${entry} no longer carries exactly one meta.tag.sgml.html rule; re-derive doctypeCaptureInCfml`);
		}

		var doctypes = sgml[0].patterns.filter((p) => p.name === "meta.tag.sgml.doctype.html");

		// Anchor check on the exact broken shape. If upstream fixes the capture
		// themselves, remove this patch rather than double-wrapping their regex.
		if (
			doctypes.length !== 1
			|| doctypes[0].begin !== BROKEN
			|| JSON.stringify(doctypes[0].captures) !== JSON.stringify({1: {name: "entity.name.tag.doctype.html"}})
		) {
			throw new Error(`${grammar.scopeName}: the ${entry} doctype rule no longer has the broken no-capture shape; remove or re-derive doctypeCaptureInCfml`);
		}

		doctypes[0].begin = `(${BROKEN})`;
	}

	// The two entries above must be the ONLY carriers of the broken shape. A
	// third copy appearing in an upstream update would survive this patch and
	// keep a plain doctype in some context nobody re-tested -- fail loudly
	// instead.
	if (count(grammar.repository, (node) => node.name === "meta.tag.sgml.doctype.html" && node.begin === BROKEN) > 0) {
		throw new Error(`${grammar.scopeName}: a no-capture doctype rule now appears outside the two HTML-content entries; extend doctypeCaptureInCfml to cover it`);
	}
}

// Last in the file: `var` hoists the binding, not the value, so this list has
// to follow the descriptors it names.
export var PATCHES = [patchBadAmpersand, patchCommentHyphens, patchBadAngleBracket, patchDoctypeCapture];
