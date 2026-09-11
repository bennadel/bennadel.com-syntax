/**
* Less patches: `source.css.less`, the stock starry-night grammar.
*
*   at-rules   `@supports`, `@keyframes` and the other CSS at-rules color as
*              keywords like `@media`, not as Less variables
*/

/**
* `@supports`, `@keyframes` and every CSS at-rule but three render as Less
* variables in a `less` fence.
*
* The Less grammar names only `@import`, `@font-face` and `@media` as
* at-rules. The next rule in line reads any `@word` as variable.other.less
* -> pl-smi, the color of `@brand`, so `@supports` and `@keyframes` color as
* variables while the `@media` above them colors as a keyword. Found via
* fixture 3595-3.less. GitHub ships the same grammar and renders the same.
*
* The variable rule is correct and stays as it is. This patch adds ONE
* sibling to the `@media` rule, right after it, carrying the other at-rule
* names the CSS specs define (with an optional vendor prefix, for
* `@-webkit-keyframes`). The at-rule rules run before the variable rule, so
* a name on the list wins the tie at `@` and anything else is still a
* variable. Same shape as the stock `@media` rule -- anchored to the start
* of a line, with its captures copied -- so it renders exactly the way
* `@media` does and nowhere `@media` does not.
*
* Two guards keep a Less variable that happens to share a name (`@container:
* 1200px;`, `@layer-width`) a variable: the name must end at a non-identifier
* character, and must not be followed by a colon. The colon guard costs
* `@page :first` its keyword color; a Less variable declaration and a page
* pseudo-class are the same `@word :` shape and the declaration is far more
* common.
*/
var patchAtRules = {
	name: "at-rules",
	branches: new Map([
		["source.css.less", atRulesInLess]
	])
};

function atRulesInLess(grammar) {
	var MEDIA = "^\\s*((@)media\\b)";
	var VARIABLE = "variable.other.less";
	var NAMES = [
		"charset", "color-profile", "container", "counter-style", "document",
		"font-feature-values", "font-palette-values", "keyframes", "layer",
		"namespace", "page", "position-try", "property", "scope",
		"starting-style", "supports", "view-transition", "viewport"
	];

	var patterns = grammar.patterns;
	var media = patterns.findIndex((p) => p.match === MEDIA && p.name === "meta.at-rule.media.css");
	var variable = patterns.findIndex((p) => p.name === VARIABLE);

	// Anchor checks: one @media rule of the expected shape, one variable rule
	// after it, and none of the names already handled (an upstream update that
	// adds one should shrink this list, not double-color the word).
	if (
		media < 0
		|| patterns.filter((p) => p.name === "meta.at-rule.media.css").length !== 1
		|| variable < media
		|| patterns.filter((p) => p.name === VARIABLE).length !== 1
		|| NAMES.some((name) => patterns.some((p) => typeof p.match === "string" && p.match.includes(`@)${name}`)))
	) {
		throw new Error(`${grammar.scopeName}: the @media and variable rules no longer have the expected shape, or an at-rule name is already handled; re-derive atRulesInLess`);
	}

	patterns.splice(media + 1, 0, {
		captures: structuredClone(patterns[media].captures),
		match: `^\\s*((@)(?:-(?:webkit|moz|ms|o)-)?(?:${NAMES.join("|")}))(?![\\w-])(?!\\s*:)`,
		name: "meta.at-rule.css"
	});

	patterns[media + 1].captures["1"].name = "keyword.control.at-rule.css";
}

// Last in the file: `var` hoists the binding, not the value, so this list has
// to follow the descriptors it names.
export var PATCHES = [patchAtRules];
