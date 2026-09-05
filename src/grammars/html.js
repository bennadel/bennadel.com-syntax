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
	["source.js", [patchMethodNameLists]],
	["source.ts", [patchTemplateProperty, patchMethodNameLists]],
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
* Chained method calls render in different colors.
*
* Both JavaScript grammars descend from the same 2004-era javascript.tmbundle
* name lists: a method name after a dot is checked against hardcoded rosters
* of DOM and standard-library names, so a jQuery chain alternates colors by
* accident of naming --
*
*   menuRoot
*       .attr( "href", "..." )   <-- pl-en: "attr" is in no list
*       .click(                  <-- pl-c1: "click" collides with DOM click()
*
* -- even though both names resolve on the same object. The lists are a guess
* at types the grammar cannot see, and the guess is keyed on nothing but the
* name. The patch deletes them so every dot-method name falls through to the
* entity.name.function fallback: one scope, one color (pl-en), matching how
* the from-scratch grammars (Sublime's, tree-sitter's) scope method calls by
* position instead of by name. This DIVERGES from GitHub, which keeps the
* alternating colors -- the divergence is the point.
*
* Deliberately KEPT, in both grammars: rules keyed on an actual global
* receiver (`console.log`, `Math.round`, `Promise.all`), which are knowledge
* rather than guesswork, and the bare-global call lists (`setTimeout(`,
* `parseInt(`), which are not dot methods.
*
* In source.js the dot-PROPERTY name lists steal methods too: the DOM
* property roster includes `text`, `link`, `top`, so jQuery's `.text(` kept
* rendering as a built-in after the method lists were gone. Those rules stay
* -- `el.href` as a recognized property is fine -- but they get the
* not-followed-by-a-paren guard that Microsoft's equivalent rules already
* carry, so a CALLED name always falls through to method_calls.
*/
function patchMethodNameLists(grammar) {
	// Exact-name node counter, used to pin the post-patch state: the deleted
	// scopes must appear NOWHERE else, or a starry-night upgrade could add a
	// second name-list rule that survives this patch and puts the alternating
	// colors back in some context nobody re-tested.
	function countScope(node, scope) {
		if (Array.isArray(node)) {
			return node.reduce((sum, item) => sum + countScope(item, scope), 0);
		}
		if (node && typeof node === "object") {
			var self = (node.name === scope) ? 1 : 0;
			return Object.values(node).reduce((sum, value) => sum + countScope(value, scope), self);
		}
		return 0;
	}

	if (grammar.scopeName === "source.js") {
		// The lists live inside the method_calls rule's name capture, tried in
		// order ahead of the entity.name.function fallback. Pin the whole
		// roster: anything reordered or renamed means the rule was reworked.
		var call = grammar.repository.method_calls;
		var EXPECTED = [
			"support.function.event-handler.js",
			"support.function.js",
			"support.function.dom.js",
			"entity.name.function.js",
			"invalid.illegal.identifier.js"
		];

		if (
			!call
			|| call.patterns.length !== 1
			|| call.patterns[0].begin !== "(\\.)\\s*([\\w$]+)\\s*(?=\\()"
			|| JSON.stringify(call.patterns[0].beginCaptures[2].patterns.map((p) => p.name)) !== JSON.stringify(EXPECTED)
		) {
			throw new Error(`${grammar.scopeName}: method_calls no longer has the expected name-list shape; re-derive patchMethodNameLists`);
		}

		// Keep only the fallback and the illegal-identifier catch; the three
		// support lists in front of them are the deletion.
		call.patterns[0].beginCaptures[2].patterns = call.patterns[0].beginCaptures[2].patterns.slice(3);

		// support.function.js legitimately survives ONCE, in function_calls'
		// bare-global list; the other two must be gone entirely.
		if (
			countScope(grammar, "support.function.event-handler.js") !== 0
			|| countScope(grammar, "support.function.dom.js") !== 0
			|| countScope(grammar, "support.function.js") !== 1
		) {
			throw new Error(`${grammar.scopeName}: a dot-method name list now appears outside method_calls; extend patchMethodNameLists to cover it`);
		}

		// The dot-property rules live in the grammar's top-level patterns and
		// must not claim a name a paren follows. Each property scope has exactly
		// one carrier, or the rules were reworked.
		for (var scope of ["support.variable.property.js", "support.variable.property.dom.js"]) {
			var properties = grammar.patterns.filter((p) => p.captures && Object.values(p.captures).some((c) => c.name === scope));

			if (
				properties.length !== 1
				|| !properties[0].match.startsWith("(?x) (\\.)")
				|| !properties[0].match.endsWith("\\b")
			) {
				throw new Error(`${grammar.scopeName}: the ${scope} rule no longer has the expected dot-property shape; re-derive patchMethodNameLists`);
			}

			properties[0].match += "(?!\\s*\\()";
		}

		return "method-name-lists";
	}

	if (grammar.scopeName === "source.ts") {
		// Microsoft folded the same rosters into ONE support-objects rule: a
		// single match keyed on a leading `.` or `?.` whose captures assign the
		// four list scopes. Deleting the whole rule drops the name to the
		// generic function-call rule -> entity.name.function.ts.
		var rules = grammar.repository["support-objects"].patterns;
		var EXPECTED_TS = [
			"punctuation.accessor.ts",
			"punctuation.accessor.optional.ts",
			"support.function.event-handler.ts",
			"support.function.ts",
			"support.function.dom.ts",
			"support.function.promise.ts"
		];
		var matches = rules.filter((p) => p.captures && Object.values(p.captures).some((c) => c.name === "support.function.dom.ts"));

		if (
			matches.length !== 1
			|| JSON.stringify(Object.values(matches[0].captures).map((c) => c.name)) !== JSON.stringify(EXPECTED_TS)
			|| !matches[0].match.startsWith("(?x) (?:(\\.)")
		) {
			throw new Error(`${grammar.scopeName}: support-objects no longer has the expected dot-method rule shape; re-derive patchMethodNameLists`);
		}

		rules.splice(rules.indexOf(matches[0]), 1);

		// support.function.ts legitimately survives ONCE, in the bare-global
		// list (parseInt, setTimeout); the other three must be gone entirely.
		if (
			countScope(grammar, "support.function.event-handler.ts") !== 0
			|| countScope(grammar, "support.function.dom.ts") !== 0
			|| countScope(grammar, "support.function.promise.ts") !== 0
			|| countScope(grammar, "support.function.ts") !== 1
		) {
			throw new Error(`${grammar.scopeName}: a dot-method name list now appears outside support-objects; extend patchMethodNameLists to cover it`);
		}

		return "method-name-lists";
	}

	throw new Error(`${grammar.scopeName}: patchMethodNameLists has no branch for this grammar; re-derive it before listing it in PATCHES`);
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
