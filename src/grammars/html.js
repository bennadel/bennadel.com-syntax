/**
* Token patches for STOCK starry-night grammars, applied to clones at boot.
*
* Unlike the CFML grammars beside this file, nothing here is vendored: the
* grammar objects come straight out of `@wooorm/starry-night`, whose bytes are
* already pinned by package-lock.json. Vendoring a copy would duplicate that
* pin with a weaker one and let the copy drift from the one the rest of the
* stock set uses -- so the patch layer is the same DISCIPLINE as cfml.js
* (named patches, asserted anchors, fail loudly at boot) without the vendoring.
*
* The patched grammar replaces the stock one in the list handed to
* createStarryNight(), so every include of `text.html.basic` BY SCOPE NAME --
* from markdown, erb, anything -- resolves to the patched clone through the
* registry. The stock module object itself is never mutated.
*/

/**
* scope name -> [patch names]. Exported so the test suite can assert that every
* patch actually ran, rather than trusting that it did.
*/
export var applied = new Map();

var PATCHES = new Map([
	["source.ts", [patchTemplateProperty]],
	["text.html.basic", [patchCommentHyphens, patchDoctypeCapture]]
]);

/**
* Returns `grammars` with each scope named in PATCHES replaced by a patched
* clone. Throws if a named scope is missing from the list: a patch that
* silently stops applying looks fixed and is not.
*/
export function patchStockGrammars(grammars) {
	var remaining = new Map(PATCHES);

	var patched = grammars.map((grammar) => {
		var patches = remaining.get(grammar.scopeName);

		if (!patches) {
			return grammar;
		}

		remaining.delete(grammar.scopeName);

		var clone = structuredClone(grammar);

		applied.set(clone.scopeName, patches.map((patch) => patch(clone)));

		return clone;
	});

	if (remaining.size > 0) {
		throw new Error(`stock grammar list no longer contains: ${[...remaining.keys()].join(", ")}`);
	}

	return patched;
}

/**
* `--` inside an HTML comment renders as invalid.illegal -> pl-ii.
*
* The twin of patchCommentHyphens in cfml.js, for the grammar `htm` fences
* resolve to. The comment rule carries a catch-all branding every inner `--`
* illegal (a lookahead spares only the closing run), which outlaws the
* archive's hyphen-run divider comments:
*
*   <!-- ------- -->
*
* HTML5 permits `--` inside comment text -- only `<!--`, `-->`, and `--!>`
* are reserved -- so the strictness is SGML-era pedantry. Found by the
* JavaScript-tag pl-ii sweep (posts 3540 and 2811, fixtures 3540-2.htm and
* 2811-1.htm).
*
* This DIVERGES from GitHub, which renders these dividers as errors. Do not
* "fix" this patch to match GitHub -- the divergence is the point: correct
* beats parity.
*
* The patch deletes ONLY the catch-all. The `#embedded-code` include stays,
* so anything the grammar embeds in comments keeps working; an inner `--` is
* simply unclaimed and falls through to the enclosing comment scope.
*/
function patchCommentHyphens(grammar) {
	var CATCH_ALL = "invalid.illegal.bad-comments-or-CDATA.html";

	// The comment rule lives in the grammar's top-level patterns, not the
	// repository. Keyed on name AND begin so the SGML rule (`<!` ... `>`),
	// which legitimately shares the scope NAME, cannot be mistaken for it.
	var comments = grammar.patterns.filter((p) => p.name === "comment.block.html" && p.begin === "<!--");

	if (comments.length !== 1) {
		throw new Error(`${grammar.scopeName}: no longer carries exactly one top-level comment.block.html rule; re-derive patchCommentHyphens`);
	}

	var index = comments[0].patterns.findIndex((p) => p.name === CATCH_ALL && typeof p.match === "string" && p.match.startsWith("--"));

	// Anchor check. If upstream drops the catch-all themselves, remove this
	// patch rather than leaving it to fail silently against nothing.
	if (index < 0) {
		throw new Error(`${grammar.scopeName}: the comment rule no longer carries the ${CATCH_ALL} catch-all; remove patchCommentHyphens`);
	}

	comments[0].patterns.splice(index, 1);

	// The comment rule must be the ONLY carrier of a `--`-shaped catch-all.
	// One appearing elsewhere in a starry-night upgrade would survive this
	// patch and put pl-ii dividers back in some context nobody re-tested --
	// fail loudly instead.
	function count(node) {
		if (Array.isArray(node)) {
			return node.reduce((sum, item) => sum + count(item), 0);
		}
		if (node && typeof node === "object") {
			var self = (node.name === CATCH_ALL && typeof node.match === "string" && node.match.startsWith("--")) ? 1 : 0;
			return Object.values(node).reduce((sum, value) => sum + count(value), self);
		}
		return 0;
	}

	if (count(grammar) > 0) {
		throw new Error(`${grammar.scopeName}: a \`--\` ${CATCH_ALL} rule now appears outside the top-level comment rule; extend patchCommentHyphens to cover it`);
	}

	return "comment-hyphens";
}

/**
* `<!DOCTYPE` renders with no scope on the keyword.
*
* The twin of patchDoctypeCapture in cfml.js -- both grammars descend from the
* same html.tmbundle SGML rule, dead capture included. The doctype sub-rule
* assigns entity.name.tag.doctype.html to CAPTURE GROUP 1 of a begin regex
* that has no capture group (`(?i:...)` is non-capturing), so the keyword
* falls through as plain text while the DTD strings beside it highlight.
*
* The patch wraps the begin in the parentheses upstream forgot; upstream's own
* captures entry then applies. This DIVERGES from GitHub's rendering (GitHub
* ships the same dead rule) the way comment-hyphens does: correct beats
* parity.
*/
function patchDoctypeCapture(grammar) {
	var BROKEN = "(?i:DOCTYPE)";

	// The SGML rule lives in the grammar's top-level patterns, like the comment
	// rule patchCommentHyphens anchors on.
	var sgml = grammar.patterns.filter((p) => p.name === "meta.tag.sgml.html" && p.begin === "<!");

	if (sgml.length !== 1) {
		throw new Error(`${grammar.scopeName}: no longer carries exactly one top-level meta.tag.sgml.html rule; re-derive patchDoctypeCapture`);
	}

	var doctypes = sgml[0].patterns.filter((p) => p.name === "meta.tag.sgml.doctype.html");

	// Anchor check on the exact broken shape. If upstream fixes the capture
	// themselves, remove this patch rather than double-wrapping their regex.
	if (
		doctypes.length !== 1
		|| doctypes[0].begin !== BROKEN
		|| JSON.stringify(doctypes[0].captures) !== JSON.stringify({1: {name: "entity.name.tag.doctype.html"}})
	) {
		throw new Error(`${grammar.scopeName}: the doctype rule no longer has the broken no-capture shape; remove or re-derive patchDoctypeCapture`);
	}

	doctypes[0].begin = `(${BROKEN})`;

	// The SGML rule must be the ONLY carrier of the broken shape. One appearing
	// elsewhere in a starry-night upgrade would survive this patch and keep a
	// plain doctype in some context nobody re-tested -- fail loudly instead.
	function count(node) {
		if (Array.isArray(node)) {
			return node.reduce((sum, item) => sum + count(item), 0);
		}
		if (node && typeof node === "object") {
			var self = (node.name === "meta.tag.sgml.doctype.html" && node.begin === BROKEN) ? 1 : 0;
			return Object.values(node).reduce((sum, value) => sum + count(value), self);
		}
		return 0;
	}

	if (count(grammar) > 0) {
		throw new Error(`${grammar.scopeName}: a no-capture doctype rule now appears outside the top-level SGML rule; extend patchDoctypeCapture to cover it`);
	}

	return "doctype-capture";
}

/**
* An inline component template renders as one flat string.
*
* Angular (and AngularJS, and Vue) components carry their markup as the
* `template` property of an object literal:
*
*   @Component({
*       template: `<a (click)="go()">Go</a>`
*   })
*
* Microsoft's grammar has no embedded-language support in template literals,
* so the markup renders as an undifferentiated string. The patch adds a rule
* to the object-literal dispatch claiming `template:` and handing a string
* value's CONTENT to text.html.basic -- which resolves through the registry
* to the patched clone, so the comment-hyphens fix applies inside templates
* too.
*
* The idea is borrowed, not invented, from two published sources: the stock
* source.js grammar already embeds text.html.basic in `html`-tagged template
* literals and `innerHTML =` assignments, and Angular's official VS Code
* grammar (inline-template.ng, angular/vscode-ng-language-service, MIT) claims
* `template:` inside decorators the same way. Their grammar cannot be adopted
* as-is for two reasons: it is an INJECTION grammar and starry-night never
* registers injections, and its string rule is `\G`-anchored to the colon, so
* it misses the archive's other formatting (the delimiter on the line after
* `template:` -- vscode-textmate resolves `\G` to never-match on later lines).
* This rule is a begin/end region instead, which spans lines.
*
* Angular-specific attribute syntax -- `(click)`, `[hidden]`, `*ngIf` -- is
* DELIBERATELY left rendering as generic attribute names (pl-e): measured
* before writing this, text.html.basic tokenizes all three shapes cleanly,
* and scoping them properly would mean vendoring Angular's template.ng
* grammar for one archive's worth of decoration.
*
* The value region mirrors upstream's own object-member value rule (begin at
* the `:`, end looking at `,` or `}`, body handed to #expression), with the
* three string forms tried first so they win the tie at the delimiter. A
* non-string value -- `template: getTemplate()` -- falls through to
* #expression and renders exactly as it did unpatched.
*/
function patchTemplateProperty(grammar) {
	var LITERAL = "object-literal";

	// Every repository entry the new rule hands content to must exist, or the
	// rule would carry an unresolvable include -- which vscode-textmate answers
	// by disabling the whole rule, silently.
	for (var required of ["object-member", "expression", "template-substitution-element", "string-character-escape"]) {
		if (!grammar.repository[required]) {
			throw new Error(`${grammar.scopeName}: repository no longer has ${required}; re-derive patchTemplateProperty`);
		}
	}

	var literal = grammar.repository[LITERAL];

	// Anchor check: the dispatch being cut in front of must still have its
	// upstream shape. Anything else means object literals were reworked --
	// re-derive the patch against the new shape rather than unshifting into a
	// list that no longer means what it did.
	if (literal.patterns.length !== 1 || literal.patterns[0].include !== "#object-member") {
		throw new Error(`${grammar.scopeName}: ${LITERAL} no longer dispatches to exactly [#object-member]; re-derive patchTemplateProperty`);
	}

	// One rule per string form: the delimiter keeps its string scope, the
	// content becomes HTML. Escapes and `${}` substitutions are tried before
	// the HTML include so they keep their TypeScript meaning.
	function stringRule(delimiter, scope) {
		return {
			begin: `(${delimiter})`,
			beginCaptures: {1: {name: `${scope} punctuation.definition.string.begin.ts`}},
			end: delimiter,
			endCaptures: {0: {name: `${scope} punctuation.definition.string.end.ts`}},
			contentName: "text.html.basic",
			patterns: [
				{include: "#template-substitution-element"},
				{include: "#string-character-escape"},
				{include: "text.html.basic"}
			]
		};
	}

	// The lookbehind stops `x_template:` from matching; `myTemplate:` already
	// cannot (the match is case-sensitive on purpose -- Angular's API name is
	// exactly `template`). A method named template() never matches: the rule
	// requires the colon.
	literal.patterns.unshift({
		begin: "(?<![_$[:alnum:]])(template)\\s*(:)",
		beginCaptures: {
			1: {name: "meta.object-literal.key.ts"},
			2: {name: "meta.object-literal.key.ts punctuation.separator.key-value.ts"}
		},
		end: "(?=,|\\})",
		name: "meta.object.member.ts",
		patterns: [
			stringRule("`", "string.template.ts"),
			stringRule("\"", "string.quoted.double.ts"),
			stringRule("'", "string.quoted.single.ts"),
			{include: "#expression"}
		]
	});

	return "template-property";
}
