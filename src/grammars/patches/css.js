/**
* CSS patches: `source.css`, the stock starry-night grammar.
*
*   nesting             nested rules highlight as rules (css-nesting.js)
*   media-features      every `(name: value)` in an `@media` header colors
*                       like a property, listed or not
*   value-identifiers   an author-defined name in a declaration value colors
*                       like a keyword value
*/

import {patchNesting} from "./css-nesting.js";

/**
* A media feature the grammar has never heard of renders as plain text.
*
* The stock grammar colors the inside of `@media (...)` from a fixed list of
* feature names (width, height, color, resolution, grid, hover, ...) and a
* fixed list of value keywords (portrait, landscape, fullscreen, ...). Both
* stop at Media Queries Level 4: `prefers-reduced-motion`, `prefers-color-
* scheme`, `pointer`, `update`, `forced-colors` and their values match
* nothing, so in one file `(min-width: 600px)` colors both halves and
* `(prefers-reduced-motion: no-preference)` colors neither. Found via fixture
* 4132-1.css. Upstream (atom/language-css) is archived, the vscode fork
* carries the same list, and GitHub renders the same gap.
*
* Every actively maintained CSS grammar (highlight.js, Prism, tree-sitter,
* Sublime) reads `(name: value)` as a generic key/value pair -- the name colors
* like a property name whether or not it is on a list. This patch does the
* same, in two parts inside the paren rule of #media-query:
*
* - The `:` becomes a begin/end rule whose content runs to the closing paren,
*   so everything after the colon is known to be a value. Its patterns are
*   the paren rule's own value patterns plus a generic identifier ->
*   support.constant.property-value.css, the scope the keyword list uses.
* - A generic identifier followed by `:`, `)` or a comparison operator ->
*   support.type.property-name.media.css, the scope the feature list uses.
*   Appended LAST so the stock rules keep winning on the names they know
*   (including the vendor-prefixed names), and `(hover)` in boolean context still
*   reads as a feature. Range syntax `(400px <= width <= 700px)` reaches it
*   through the comparison-operator lookahead.
*
* Consuming the value in a sub-rule is what makes the name rule safe: without
* it, `no-preference` sits before `)` and would read as a feature name.
*/
var patchMediaFeatures = {
	name: "media-features",
	branches: new Map([
		["source.css", mediaFeaturesInCss]
	])
};

function mediaFeaturesInCss(grammar) {
	var query = grammar.repository["media-query"];
	var KEY_VALUE = "punctuation.separator.key-value.css";

	var parens = query.patterns.filter((p) => p.begin === "\\(" && p.end === "\\)");

	if (
		query.begin !== "\\G"
		|| query.end !== "(?=\\s*[{;])"
		|| parens.length !== 1
	) {
		throw new Error(`${grammar.scopeName}: media-query no longer has one \\( ... \\) rule; re-derive mediaFeaturesInCss`);
	}

	var patterns = parens[0].patterns;

	// The value patterns are looked up by identity so the sub-rule reuses the
	// grammar's own objects. Each must be present exactly once.
	function one(test, label) {
		var found = patterns.filter(test);

		if (found.length !== 1) {
			throw new Error(`${grammar.scopeName}: media-query's paren rule no longer has exactly one ${label}; re-derive mediaFeaturesInCss`);
		}

		return found[0];
	}

	var colon = one((p) => p.match === ":" && p.name === KEY_VALUE, `${KEY_VALUE} match`);

	// Asserted only: the known-name rule must still be there, ahead of the
	// generic one appended below.
	one((p) => p.include === "#media-features", "#media-features include");

	var keywords = one((p) => p.include === "#media-feature-keywords", "#media-feature-keywords include");
	var ratio = one((p) => p.name === "meta.ratio.css", "meta.ratio.css rule");
	var numbers = one((p) => p.include === "#numeric-values", "#numeric-values include");
	var comments = one((p) => p.include === "#comment-block", "#comment-block include");

	// Same identifier shape and same neighbors as the stock feature regex: it
	// must be preceded by whitespace, the open paren or a comment, and it must
	// end cleanly. The name lookahead is what distinguishes a name from a
	// stray word, and the value rule only ever runs after a colon.
	var IDENT = "[-a-zA-Z_][-\\w]*";

	// The four reused objects now sit in two places in this grammar. Do not
	// write a whole-grammar count over source.css that expects to see any of
	// them once.
	patterns[patterns.indexOf(colon)] = {
		begin: ":",
		beginCaptures: {
			"0": {name: KEY_VALUE}
		},
		end: "(?=\\))",
		patterns: [
			comments,
			keywords,
			ratio,
			numbers,
			{
				match: `(?i)(?<=^|\\s|:|\\*/)${IDENT}(?=\\s|\\)|$|/\\*)`,
				name: "support.constant.property-value.css"
			}
		]
	};

	patterns.push({
		match: `(?i)(?<=^|\\s|\\(|\\*/)${IDENT}(?=\\s*(?:[:)<>=]|/\\*))`,
		name: "support.type.property-name.media.css"
	});
}

/**
* An author-defined name in a declaration value renders as plain text.
*
* The stock grammar colors a value only from lists: property keywords, color
* names, a short list of common font names, numbers, strings, functions. A
* name the author invented -- an animation name, a grid area, a counter, a
* transition-property target, a font the list lacks -- matches nothing, so
* `animation-name: modal-enter` colors the property and leaves the value
* plain between a colored `fixed` and a colored `ease-out`, and the name that
* `@keyframes` defines in one color is referenced in none. Found via fixture
* 4132-1.css. Upstream (atom/language-css) is archived, the vscode fork has
* the same value patterns, and GitHub renders the same gap.
*
* The grammars that model a value as a POSITION rather than a list (Sublime,
* Lezer/CodeMirror, starry-night's own Less) color every identifier there,
* and Sublime gives an unknown one the same scope as a known keyword. This
* patch does the same: a bare identifier in value position that no other
* rule claimed -> support.constant.property-value.css, the scope the keyword
* list uses, so `modal-enter` renders like `ease-out` beside it. Appended
* LAST in #property-values so every existing rule keeps winning on a tie.
*
* The identifier must not be followed by `(`, so an unknown function name
* stays as it was (plain, with colored arguments) rather than coloring as a
* value with its parens dangling. The negative lookahead has to cover the
* identifier characters too, or the regex backtracks one character to escape
* the paren test and colors `my-f` of `my-fn(`.
*
* Every context that includes #property-values inherits this: function
* arguments, `:dir()`, `@supports` conditions, and the value of a custom
* property, which the declaration rule does not distinguish. All of those
* are value positions, so the outcome is the same one -- with ONE exception.
* The misc-function rule (attr, blur, clamp, counter, ...) follows its
* #property-values include with a catch-all that scopes any leftover argument
* variable.parameter.misc.css -> pl-v, so `attr(data-x)` and `counter(item)`
* color as variables. The generic rule would preempt that catch-all. So the
* stock pattern list moves to a new repository entry, #property-values-listed,
* which that one rule is repointed at; #property-values becomes the listed
* set plus the generic rule for everyone else.
*/
var patchValueIdentifiers = {
	name: "value-identifiers",
	branches: new Map([
		["source.css", valueIdentifiersInCss]
	])
};

function valueIdentifiersInCss(grammar) {
	var values = grammar.repository["property-values"];
	var SCOPE = "support.constant.property-value.css";
	var IMPORTANT = "!\\s*important(?![\\w-])";

	if (
		!Array.isArray(values.patterns)
		|| values.patterns.at(-1).match !== IMPORTANT
		|| !["#functions", "#property-keywords", "#numeric-values", "#color-keywords", "#string"].every((include) => values.patterns.some((p) => p.include === include))
	) {
		throw new Error(`${grammar.scopeName}: property-values no longer ends with the !important rule after the expected includes; re-derive valueIdentifiersInCss`);
	}

	// The keyword rules carry this scope; the generic rule must render the
	// same way they do, so it borrows the name rather than inventing one.
	if (!grammar.repository["property-keywords"].patterns.some((p) => p.name === SCOPE)) {
		throw new Error(`${grammar.scopeName}: property-keywords no longer scopes ${SCOPE}; re-derive valueIdentifiersInCss`);
	}

	// Identifier per css-syntax: optional leading dashes, a letter, underscore
	// or non-ASCII start, then letters, digits, dashes, underscores or
	// non-ASCII. Not preceded by an identifier character, `#` (hex color) or
	// `.` (a class in a functional pseudo-class argument).
	var START = "(?:[a-zA-Z_]|[^\\x00-\\x7F])";
	var REST = "(?:[-\\w]|[^\\x00-\\x7F])";

	var LISTED = "#property-values-listed";
	var MISC = "variable.parameter.misc.css";

	// The one include that must keep the stock list: the rule whose patterns
	// end with the misc catch-all. Exactly one, and the include must precede
	// the catch-all, or the repointing below fixes the wrong thing.
	var misc = grammar.repository.functions.patterns.filter((p) => {
		var patterns = p.patterns || [];
		var last = patterns.at(-1);

		return (last && last.name === MISC && last.match === "[^'\"),\\s]+")
			&& patterns.some((q) => q.include === "#property-values");
	});

	if (misc.length !== 1 || grammar.repository[LISTED.slice(1)]) {
		throw new Error(`${grammar.scopeName}: functions no longer has exactly one rule ending in the ${MISC} catch-all, or ${LISTED} already exists; re-derive valueIdentifiersInCss`);
	}

	for (var pattern of misc[0].patterns) {
		if (pattern.include === "#property-values") {
			pattern.include = LISTED;
		}
	}

	grammar.repository[LISTED.slice(1)] = {patterns: values.patterns};

	values.patterns = [
		{include: LISTED},
		{
			match: `(?<![\\w#.-])-{0,2}${START}${REST}*(?!${REST}|\\s*\\()`,
			name: SCOPE
		}
	];
}

// Last in the file: `var` hoists the binding, not the value, so this list has
// to follow the descriptors it names.
export var PATCHES = [patchNesting, patchMediaFeatures, patchValueIdentifiers];
