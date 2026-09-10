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
	["source.css", [patchNesting, patchMediaFeatures]],
	["source.js", [patchMethodNameLists, patchConsoleGlobal, patchObjectKeys]],
	["source.ts", [patchTemplateProperty, patchMethodNameLists, patchConsoleGlobal, patchObjectKeys, patchPropertyNames]],
	["source.sql", [patchStatementKeywords]],
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
* receiver (`Math.round`, `Promise.all`), which are knowledge rather than
* guesswork, and the bare-global call lists (`setTimeout(`, `parseInt(`),
* which are not dot methods. The one receiver rule that does go is
* `console`'s -- patchConsoleGlobal, for a different reason.
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
* `console` renders as a type name, and its methods as built-ins.
*
* Both grammars give `console` a rule of its own, keyed on the receiver and
* carrying a roster of its methods, and neither treats any other global that
* way: `document`, `window`, `navigator` are one entry in a list scoped
* support.variable.dom, and the method after them is whatever the method-call
* rule says. So two adjacent lines render with their colors swapped --
*
*   console.info( "Setup" );                    <-- pl-en . pl-c1 (js)
*                                                   pl-c1 . pl-c1 (ts)
*   document.addEventListener( "mousedown", f ); <-- pl-c1 . pl-en (both)
*
* -- and a reader has no reason to expect the two globals to differ. The
* patch reduces each console rule to a bare receiver match carrying the same
* support.variable.dom scope the other globals have, so `console` colors like
* `document` and the method after it falls through to the ordinary method-call
* rule like any other. The method roster goes with the rule: `console.table(`
* and `console.log(` are the same kind of thing, and the roster made them
* differ. This DIVERGES from GitHub, which keeps the special rule.
*/
function patchConsoleGlobal(grammar) {
	// Exact-name node counter, used to pin the post-patch state: the console
	// scopes must appear NOWHERE else, or a starry-night upgrade could add a
	// second console rule that survives this patch and puts the type-name color
	// back in some context nobody re-tested.
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
		// A begin/end rule in the top-level patterns: `console` opens it, the
		// nested rule scopes the method, and the end matches after the call's
		// closing paren. Pin the begin regex and the receiver scope: anything
		// else means the rule was reworked.
		var BEGIN = "(?<![\\w$])console(?![\\w$]|\\s*:)";
		var rules = grammar.patterns.filter((p) => p.begin === BEGIN);

		if (
			rules.length !== 1
			|| typeof rules[0].end !== "string"
			|| !rules[0].beginCaptures
			|| !rules[0].beginCaptures["0"]
			|| rules[0].beginCaptures["0"].name !== "entity.name.type.object.console.js"
		) {
			throw new Error(`${grammar.scopeName}: the console rule no longer has the expected begin/end shape; re-derive patchConsoleGlobal`);
		}

		// Same position, same regex, no body: the receiver alone, scoped like
		// `document`. The `.method(` after it is method_calls' business.
		grammar.patterns[grammar.patterns.indexOf(rules[0])] = {
			match: BEGIN,
			name: "support.variable.dom.js"
		};

		if (
			countScope(grammar, "entity.name.type.object.console.js") !== 0
			|| countScope(grammar, "support.function.console.js") !== 0
		) {
			throw new Error(`${grammar.scopeName}: a console scope now appears outside the top-level console rule; extend patchConsoleGlobal to cover it`);
		}

		return "console-global";
	}

	if (grammar.scopeName === "source.ts") {
		// Microsoft's version is one match in support-objects: the receiver,
		// then an optional accessor and method roster. Cut the match after the
		// receiver group and drop the accessor and method captures with it.
		var HEAD = "(?x)(?<![_$[:alnum:]])(?:(?<=\\.\\.\\.)|(?<!\\.))(console)";
		var TAIL = "\\b(?!\\$)";
		var EXPECTED_TS = [
			"support.class.console.ts",
			"punctuation.accessor.ts",
			"punctuation.accessor.optional.ts",
			"support.function.console.ts"
		];
		var objects = grammar.repository["support-objects"].patterns;
		var matches = objects.filter((p) => p.captures && Object.values(p.captures).some((c) => c.name === "support.class.console.ts"));

		if (
			matches.length !== 1
			|| JSON.stringify(Object.values(matches[0].captures).map((c) => c.name)) !== JSON.stringify(EXPECTED_TS)
			|| !matches[0].match.startsWith(HEAD)
			|| !matches[0].match.endsWith(TAIL)
		) {
			throw new Error(`${grammar.scopeName}: the support-objects console rule no longer has the expected shape; re-derive patchConsoleGlobal`);
		}

		matches[0].match = `${HEAD}${TAIL}`;
		matches[0].captures = {
			"1": {
				name: "support.variable.dom.ts"
			}
		};

		if (
			countScope(grammar, "support.class.console.ts") !== 0
			|| countScope(grammar, "support.function.console.ts") !== 0
		) {
			throw new Error(`${grammar.scopeName}: a console scope now appears outside support-objects; extend patchConsoleGlobal to cover it`);
		}

		return "console-global";
	}

	throw new Error(`${grammar.scopeName}: patchConsoleGlobal has no branch for this grammar; re-derive it before listing it in PATCHES`);
}

/**
* Object-literal keys render as plain text.
*
* GitHub itself no longer renders JavaScript or TypeScript with these TextMate
* grammars: file views and gists moved to a tree-sitter pipeline that scopes
* keys by position, so a gist shows `duration:` as a constant (pl-c1) while
* the same code here left it bare. The patch adopts that coloring --
* constant.other.object.key, the scope Atom's later grammars used, which the
* theme maps to pl-c1. Quoted keys stay strings, numeric keys stay numbers,
* and a key whose value is a `function` keeps entity.name.function; those all
* match the tree-sitter output already. (An arrow-valued key in source.js is
* the one divergence: tree-sitter scopes it as a function name, but Atom's
* grammar has no rule for that shape, so it takes the constant scope here.)
*
* The two grammars need different surgery. Microsoft's TS grammar already
* MATCHES bare keys -- inside object-literal regions, with a rule that assigns
* only a meta scope, which the theme maps to nothing -- so the identifier
* there just gains a capture. Atom's JS grammar has no object-literal context
* at all (`{` is just punctuation), so the patch ADDS a rule: an identifier
* before a colon, at line start or after `{` or `,`. That anchor is what
* keeps ternary branches (`a ? b : c` -- `b` follows `?`) and `case foo:`
* (`foo` follows a space) unclaimed; `default:`/`case:` are excluded by name
* because a match from the leading whitespace would start EARLIER in the line
* than the switch rules' own keyword match, and vscode-textmate awards ties
* like that to the earliest start. The one known false positive is a
* statement label (`outer: for`), which is indistinguishable from a key
* without a parser.
*/
function patchObjectKeys(grammar) {
	// Exact-shape carrier finder: the bare-identifier key rule is the one whose
	// ONLY capture assigns the meta key scope to the whole match.
	function findCarriers(node, scope, found) {
		if (Array.isArray(node)) {
			node.forEach((item) => findCarriers(item, scope, found));
		} else if (node && typeof node === "object") {
			if (
				node.captures
				&& Object.keys(node.captures).length === 1
				&& node.captures[0]
				&& node.captures[0].name === scope
			) {
				found.push(node);
			}
			Object.values(node).forEach((value) => findCarriers(value, scope, found));
		}
		return found;
	}

	if (grammar.scopeName === "source.ts") {
		var carriers = findCarriers(grammar, "meta.object-literal.key.ts", []);

		// Anchor check: exactly one such rule, with the identifier still spelled
		// the way the rewrap below expects. More carriers, or a reshaped match,
		// means object members were reworked -- re-derive rather than guessing
		// which one is the key rule.
		if (
			carriers.length !== 1
			|| !carriers[0].match.startsWith("(?:[_$[:alpha:]][_$[:alnum:]]*)")
		) {
			throw new Error(`${grammar.scopeName}: the object-key rule no longer has the expected shape; re-derive patchObjectKeys`);
		}

		// Promote the identifier's non-capturing group to group 1 and scope it.
		// The whole-match meta scope stays, mirroring upstream's own numeric-key
		// and function-key siblings.
		carriers[0].match = `(${carriers[0].match.slice("(?:".length)}`;
		carriers[0].captures[1] = {name: "constant.other.object.key.ts"};

		return "object-keys";
	}

	if (grammar.scopeName === "source.js") {
		// Nothing in the grammar may already assign the scope this rule adds --
		// a second claimant appearing in a starry-night upgrade would mean keys
		// are now scoped twice, each in contexts nobody re-tested.
		function countScope(node) {
			if (Array.isArray(node)) {
				return node.reduce((sum, item) => sum + countScope(item), 0);
			}
			if (node && typeof node === "object") {
				var self = (node.name === "constant.other.object.key.js") ? 1 : 0;
				return Object.values(node).reduce((sum, value) => sum + countScope(value), self);
			}
			return 0;
		}

		if (countScope(grammar) !== 0) {
			throw new Error(`${grammar.scopeName}: upstream now scopes object keys itself; remove or re-derive patchObjectKeys`);
		}

		// Appended, not unshifted: everything the grammar claims today it must
		// keep claiming; this rule only picks up identifiers that fell through.
		// The `function` exclusion is load-bearing for the same claims-first
		// reason as default/case: the grammar's own function-in-object rule
		// scopes `success: function( ... )` keys entity.name.function (pl-en,
		// matching source.ts and the tree-sitter output), but it would lose the
		// earliest-start tie to this rule.
		grammar.patterns.push({
			match: "(?:^|(?<=[{,]))\\s*(?!default\\b|case\\b)([\\w$]+)(?=\\s*:)(?!\\s*:\\s*function\\b)",
			captures: {1: {name: "constant.other.object.key.js"}}
		});

		return "object-keys";
	}

	throw new Error(`${grammar.scopeName}: patchObjectKeys has no branch for this grammar; re-derive it before listing it in PATCHES`);
}

/**
* One property name renders in three colors.
*
* Microsoft's grammar scopes a property by the position it appears in, and the
* theme maps each position differently:
*
*   public projects: string[];     <-- variable.object.property -> pl-v, orange
*   this.projects = [];            <-- variable.other.property  -> pl-smi, plain
*   { projects: [] }               <-- pl-c1, blue, via patchObjectKeys
*
* A reader sees one thing -- the name of a property -- in three colors, with
* the DECLARATION the odd one out in orange, a color the theme otherwise
* reserves for variables in string interpolation. GitHub's tree-sitter
* pipeline scopes every property identifier alike and renders all three
* pl-c1, and the patch adopts that, as patchObjectKeys did for keys.
*
* Each carrier's name gains a trailing constant.other.property.ts. A rule
* name may list several space-separated scopes, and the LAST is the innermost,
* which is the one the theme lookup resolves first -- so appending is enough,
* and upstream's own scope stays in place ahead of it for anything that keys
* on the original name. The carriers are the field declaration (one rule
* serves class fields and interface and type-literal members alike, so all
* three render pl-c1 -- as tree-sitter's property_signature does), the
* destructuring key (`{ projects: p }` -- a key by another syntax), the
* dot-access identifier, and the dot-access identifier that is itself followed
* by another accessor (`this.a.b`, where `a` takes the object.property scope).
* Upstream's UPPER_CASE property scopes already carry variable.other.constant
* and were pl-c1 all along, so they are not carriers here. Parameter
* properties (`constructor( private a: string )`) are parameters to the
* grammar and stay pl-v.
*/
function patchPropertyNames(grammar) {
	var ADDED = "constant.other.property.ts";

	// scope -> how many carriers upstream ships. Pinned exactly rather than
	// "at least one": a new carrier in a starry-night upgrade is a context
	// nobody re-tested -- an enum member, a parameter property -- where pl-c1
	// may be the wrong answer, so it should fail here and be looked at.
	var EXPECTED = new Map([
		["variable.object.property.ts", 2],
		["variable.other.property.ts", 1],
		["variable.other.object.property.ts", 1]
	]);

	var found = new Map([...EXPECTED.keys()].map((scope) => [scope, 0]));

	// Every scope-bearing `name` in the grammar, rule names and capture names
	// alike -- both are objects with a string `name`, and nothing else in a
	// grammar carries that key.
	function walk(node) {
		if (Array.isArray(node)) {
			node.forEach(walk);
		} else if (node && typeof node === "object") {
			if (typeof node.name === "string") {
				var scopes = node.name.split(" ");

				// If upstream starts assigning this scope themselves, remove
				// this patch rather than stacking a second copy on theirs.
				if (scopes.includes(ADDED)) {
					throw new Error(`${grammar.scopeName}: upstream now scopes ${ADDED} itself; remove or re-derive patchPropertyNames`);
				}

				for (var scope of scopes) {
					if (found.has(scope)) {
						found.set(scope, found.get(scope) + 1);
						node.name = `${node.name} ${ADDED}`;
					}
				}
			}

			Object.values(node).forEach(walk);
		}
	}

	walk(grammar);

	for (var [scope, expected] of EXPECTED) {
		if (found.get(scope) !== expected) {
			throw new Error(`${grammar.scopeName}: ${scope} now has ${found.get(scope)} carriers, expected ${expected}; re-derive patchPropertyNames`);
		}
	}

	return "property-names";
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
	// requires the colon. The key carries the same constant scope
	// patchObjectKeys assigns, so `template:` colors like its sibling keys.
	literal.patterns.unshift({
		begin: "(?<![_$[:alnum:]])(template)\\s*(:)",
		beginCaptures: {
			1: {name: "meta.object-literal.key.ts constant.other.object.key.ts"},
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

/**
* `EXPLAIN` and `WITH` render as plain text in a `sql` fence.
*
* The stock grammar is the old TextMate sql.tmbundle, whose statement
* keywords are one short DML alternation -- select, insert into, update,
* delete, the joins. Neither word is in it: the bundle predates EXPLAIN's
* spread beyond MySQL and Postgres and predates common table expressions
* altogether, and GitHub ships the same rule, so it leaves both plain too. In
* the archive EXPLAIN opens whole posts about query plans and WITH opens
* every CTE, and an unhighlighted first word above a highlighted SELECT reads
* as a typo.
*
* The patch prepends both to that alternation, with `ANALYZE` and `RECURSIVE`
* folded in the way the rule already folds `union(\s+all)?`: a bare `explain`
* entry would color half of `EXPLAIN ANALYZE` and leave the other half plain,
* and likewise `WITH RECURSIVE`. This DIVERGES from GitHub the way
* comment-hyphens does: correct beats parity.
*
* Only the stock grammar needs this. cfquery bodies and queryExecute strings
* route to cfmleditor's inlined vscode-mssql grammar, whose generic keyword
* list already carries `with` and `recursive` (patchSqlColumnWords in
* cfml.js edits that list).
*/
function patchStatementKeywords(grammar) {
	var SCOPE = "keyword.other.DML.sql";
	var HEAD = "(?i:\\b(select(\\s+distinct)?|";

	// The DML rule lives in the grammar's top-level patterns, not the repository.
	var rules = grammar.patterns.filter((p) => p.name === SCOPE);

	// Anchor check on the alternation's opening. Anything else means upstream
	// reworked the rule -- re-derive rather than splicing into a stranger. An
	// `explain` or `with` already present means upstream added it; drop that
	// word from this patch.
	if (
		rules.length !== 1
		|| !rules[0].match.startsWith(HEAD)
		|| /\b(explain|with)\b/i.test(rules[0].match)
	) {
		throw new Error(`${grammar.scopeName}: the ${SCOPE} rule no longer has the expected alternation; re-derive patchStatementKeywords`);
	}

	rules[0].match = `${HEAD}explain(\\s+analyze)?|with(\\s+recursive)?|${rules[0].match.slice(HEAD.length)}`;

	// The top-level rule must be the ONLY carrier of the scope. A second one
	// appearing in a starry-night upgrade would leave EXPLAIN and WITH plain in
	// some context nobody re-tested -- fail loudly instead.
	function count(node) {
		if (Array.isArray(node)) {
			return node.reduce((sum, item) => sum + count(item), 0);
		}
		if (node && typeof node === "object") {
			var self = (node.name === SCOPE) ? 1 : 0;
			return Object.values(node).reduce((sum, value) => sum + count(value), self);
		}
		return 0;
	}

	if (count(grammar) !== 1) {
		throw new Error(`${grammar.scopeName}: a ${SCOPE} rule now appears outside the top-level patterns; extend patchStatementKeywords to cover it`);
	}

	return "statement-keywords";
}

/**
* A nested rule inside a CSS block renders as a broken declaration.
*
* The stock grammar predates CSS nesting: the contents of a `{}` block are
* parsed as declarations only, so in
*
*   .textBlock * {
*     &:focus,
*     &:focus-visible {
*       animation-name: none;
*     }
*   }
*
* the `&` matches nothing, the `:` opens a property value that runs to the
* next `;`, and `focus, &:focus-visible { animation-name` is swallowed as that
* value. A nested `.b { color: red; }` is worse: `b` colors as a property
* name and the inner `}` closes the OUTER rule, so everything after it parses
* at the wrong level. Found via fixture 4864-2.css.
*
* Upstream (atom/language-css) is archived and will not get this; Linguist and
* starry-night still track it. Microsoft's fork of the same grammar
* (microsoft/vscode-css) added nesting, and this patch ports that change:
*
* - `&` in a selector scopes entity.name.tag.nesting.css -> pl-ent, the same
*   color as `*` and element names, matching SCSS's `&`.
* - A selector may start with `&`, and `&` no longer marks a class or id
*   invalid (only `&` followed by an identifier is: `.a&b`).
* - A block's contents also try #selector, so a nested rule opens a nested
*   block. Telling `a:hover {` from `color: red;` is the whole difficulty; the
*   fork's selector `begin` rejects anything on the line that reads as a
*   declaration (a colon followed by whitespace, a `;` or `}` before any `{`),
*   and known property names are tried before the selector so `color:red`
*   with no space still colors as a property.
* - The names that are both an element and a property (span, mask, filter,
*   font, content, ...) get a dedicated rule (#shared-names) that reads them
*   as a selector unless the line reads as a declaration. The two lists are
*   exactly the intersection of the grammar's tag-names and property-names
*   alternations, which the patch verifies against both regexes.
* - The body of a nested `@media` (and of any at-rule the grammar has no
*   dedicated rule for) also tries declarations, so `.a { @media (...) {
*   color: blue; } }` colors its declaration.
*
* The regex text below is the fork's, `(?x)` comments included, with ONE
* deviation: #shared-names rejects a name on "a `;` before any `{`", where
* the fork rejects on "a `;` anywhere on the line". The fork's test reads a
* one-line nested rule -- `span { color: red; }` -- as the property `span`,
* whose value then runs to the `;` and whose `}` closes the ENCLOSING block,
* so every line after it parses at the wrong level. The selector rule's own
* test is already "before any `{`"; this makes the two agree. Otherwise do not
* tidy the regex text into local style: keeping it comparable to
* extensions/css/syntaxes/css.tmLanguage.json in the vscode repository is
* what makes the next upstream diff readable.
*/
function patchNesting(grammar) {
	var repo = grammar.repository;
	var NESTING = "entity.name.tag.nesting.css";

	// -- selector: may start with `&`, must not read as a declaration --------------

	var selector = repo.selector;

	if (
		!selector
		|| !selector.begin.startsWith("(?x)\n(?=\n  (?:\\|)?")
		|| selector.end !== "(?=\\s*[/@{)])"
	) {
		throw new Error(`${grammar.scopeName}: the selector rule no longer has the expected begin/end; re-derive patchNesting`);
	}

	selector.begin = [
		"(?xi)",
		"# Match must be preceded by one of the following:",
		"(?<=",
		"    ^                             # Start of line",
		"  | (^|[^\\:])\\s                 # Whitespace, after the start of a line or any character except a colon (which denotes a property)",
		"  | ;                             # Semicolon (condensed property list syntax)",
		"  | [{}]                          # Opening or closing brace (condensed property list syntax)",
		"  | \\*/                          # Comment end",
		"  | \\\\(?:[0-9a-fA-F]{1,6}|.)    # Escape sequence",
		")",
		"",
		"# Match may contain any of the following:",
		"(?=",
		"  (?:",
		"    # Match must start with one of the following:",
		"      &                           # Nesting selector",
		"    | \\*                         # Universal selector",
		"    | [>~+]                       # Selector combinator",
		"    | \\|                         # Selector namespace separator",
		"    | \\[                         # Attribute selector opening bracket",
		"    | [a-zA-Z]                    # Letter",
		"    | [^\\x00-\\x7F]              # Non-ASCII symbols",
		"    | \\\\(?:[0-9a-fA-F]{1,6}|.)  # Escape sequence",
		"",
		"    # Or one of the following symbols, followed by a word character, hyphen, or escape sequence:",
		"    | (?:",
		"          \\.                     # Class selector",
		"        | \\#                     # ID selector",
		"      )",
		"      (?:",
		"          [\\w-]                  # Word character or hyphen",
		"        | \\\\(?:                 # Escape sequence",
		"                [0-9a-fA-F]{1,6}",
		"              | .",
		"            )",
		"      )",
		"",
		"    # Or one of the following symbols, followed a letter or hyphen:",
		"    | (?:",
		"          \\:                     # Pseudo-class",
		"        | \\:\\:                  # Pseudo-element",
		"      )",
		"      [a-zA-Z-]                   # Letter or hyphen",
		"  )",
		")",
		"",
		"# Match must NOT contain any of the following:",
		"(?!",
		"    [\\w-]*[\\:]+\\s              # One or more colons immediately followed by a whitespace (denotes a property or invalid sequence)",
		"  | [^{]*;                        # Any characters and a semicolon before an opening bracket (denotes the end of a property)",
		"  | [^{]*}                        # A closing bracket before an opening bracket (denotes a property)",
		"  | [^\\:]+(\\:\\:):+             # More than two colons (invalid sequence)",
		")"
	].join("\n");

	selector.end = [
		"(?x)",
		"# Match must end with:",
		"(?=",
		"  \\s*                            # Optional whitespace and one of the following:",
		"  (?:",
		"      \\/                         # Comment",
		"    | @                           # At-rule",
		"    | {                           # Opening property list brace",
		"    | \\)                         # Closing function brace (for passing test on `some-edgy-new-function(`)",
		"    | $                           # End of line",
		"  )",
		")"
	].join("\n");

	// -- selector-innards: the `&` token, and `&` as a legal neighbor ---------------

	var innards = repo["selector-innards"].patterns;

	var wildcards = innards.filter((p) => p.match === "\\*" && p.name === "entity.name.tag.wildcard.css");

	if (wildcards.length !== 1 || innards.some((p) => p.match === "&")) {
		throw new Error(`${grammar.scopeName}: selector-innards no longer has exactly one wildcard rule and no \`&\` rule; re-derive patchNesting`);
	}

	innards.splice(innards.indexOf(wildcards[0]), 0, {match: "&", name: NESTING});

	// Each needle is a fragment of one of the fork's edited regexes. The count
	// pins how many rules carry it, so a starry-night upgrade that adds or
	// drops one fails here instead of leaving `&` invalid in that one context.
	function replaceInMatches(needle, replacement, expected) {
		var carriers = innards.filter((p) => typeof p.match === "string" && p.match.includes(needle));

		if (carriers.length !== expected) {
			throw new Error(`${grammar.scopeName}: ${carriers.length} selector-innards rules carry ${JSON.stringify(needle)}, expected ${expected}; re-derive patchNesting`);
		}

		for (var rule of carriers) {
			rule.match = rule.match.split(needle).join(replacement);
		}
	}

	// The "followed by another selector" class shared by the class, id, and
	// bad-identifier rules: `.foo&` is a valid compound.
	replaceInMatches("[\\s,.\\#)\\[:{>+~|]", "[\\s,.\\#)\\[:{>+~|&]", 3);

	// The namespace-prefix rule's "make sure there's a selector to match".
	replaceInMatches("[-\\[:.*\\#a-zA-Z_]    # Make sure there's a selector to match", "[-\\[:.*&\\#a-zA-Z_]   # Make sure there's a selector to match", 1);

	// The bad-identifier rule's invalid-punctuation class: `&` leaves it, and
	// comes back as its own alternative that only fires before an identifier.
	replaceInMatches("[!\"'%&(*;<?@^`|\\]}]", "[!\"'%(*;<?@^`|\\]}]|&(?=[-a-zA-Z_0-9]|[^\\x00-\\x7F])", 1);

	// -- shared-names: element names that are also property names -----------------

	if (repo["shared-names"]) {
		throw new Error(`${grammar.scopeName}: repository already has shared-names; remove patchNesting`);
	}

	var PLAIN = ["header", "image", "label", "marquee", "mask", "nav", "ruby", "shadow", "span", "style", "color-profile", "line", "text"];
	var COLONED = ["content", "font", "mark", "cursor", "filter"];

	// Both lists must be exactly the names the grammar's own tag-names and
	// property-names alternations share. Either alternation growing a new
	// collision (or losing one) means the lists here are wrong.
	function alternation(source) {
		return new Set(source.replace(/#[^\n]*/g, "").replace(/\s+/g, "").match(/[a-z][a-z0-9-]*/gi));
	}

	var tags = alternation(repo["tag-names"].match.split("(?:")[1]);
	var properties = alternation(repo["property-names"].patterns[0].match.split("(?:")[1]);
	var shared = [...tags].filter((name) => properties.has(name)).sort().join(",");

	if (shared !== [...PLAIN, ...COLONED].sort().join(",")) {
		throw new Error(`${grammar.scopeName}: tag-names and property-names now share [${shared}]; update the shared-names lists in patchNesting`);
	}

	var SHARED_PRECEDED_BY = [
		"(?xi)",
		"# Selector match must be preceded by one of the following:",
		"(?<=",
		"    ^                           # Start of line",
		"  | (^|[^\\:])\\s               # Whitespace, after the start of a line or any character except a colon",
		"  | [{}]                        # Opening or closing brace (condensed property list syntax)",
		"  | \\*/                        # Comment end",
		"  | \\\\(?:[0-9a-fA-F]{1,6}|.)  # Escape sequence",
		")",
		""
	].join("\n");

	var SHARED_END = [
		"(?xi)",
		"# Selector match ends with one of the following:",
		"(?=",
		"    \\s                           # Whitespace",
		"  | \\/\\*                        # Comment",
		"  | ,                             # Comma",
		"  | {                             # Opening property list brace",
		"  | $                             # End of line",
		")"
	].join("\n");

	repo["shared-names"] = {
		patterns: [
			{
				begin: SHARED_PRECEDED_BY + [
					"(?=",
					"  # Selector must match:",
					"  (?:",
					"    # HTML elements",
					"    header|image|label|marquee|mask|nav|ruby|shadow|span|style",
					"    # SVG elements",
					"    |color-profile|line|text",
					"  )",
					"",
					"  # Selector must NOT be followed by any any of the following:",
					"  (?!",
					"      [^{]*;                    # A semicolon before any opening brace (denotes a property)",
					"    | [^{]*}                    # Any characters, except an opening brace, followed by a closing bracket (denotes a property)",
					"    | -                         # A dash (denotes a property name)",
					"    | \\:\\s+                   # A colon followed by whitespace (denotes a property name)",
					"  )",
					")"
				].join("\n"),
				end: SHARED_END,
				patterns: [{include: "#selector"}]
			},
			{
				begin: SHARED_PRECEDED_BY + [
					"(?=",
					"  # Selector must match:",
					"  (?:",
					"    # HTML elements",
					"    content|font|mark",
					"    # SVG elements",
					"    |cursor|filter",
					"  )",
					"",
					"  # Selector must NOT be followed by any any of the following:",
					"  (?!",
					"      [^{]*;                    # A semicolon before any opening brace (denotes a property)",
					"    | [^{]*}                    # Any characters, except an opening brace, followed by a closing bracket (denotes a property)",
					"    | -                         # A dash (denotes a property name)",
					"    | \\:                     # A colon, unless it's with one of the following:",
					"    (?!",
					"      # An opening bracket before a closing bracket",
					"        [^}]*{",
					"      # A pseudo-class selectors",
					"      | active|any-link|checked|disabled|empty|enabled|first",
					"      | (?:first|last|only)-(?:child|of-type)|focus|focus-visible|focus-within|fullscreen|host|hover",
					"      | in-range|indeterminate|invalid|link|out-of-range",
					"      | read-only|read-write|required|root|scope|target|unresolved",
					"      | valid|visited",
					"",
					"      # A functional pseudo-class selectors",
					"      | (?: dir|lang",
					"          | not|has|matches|where|is",
					"          | nth-(?:last-)?(?:child|of-type)",
					"        )\\(",
					"",
					"      # A single-colon pseudo-element selectors",
					"      | after",
					"      | before",
					"      | first-letter",
					"      | first-line",
					"      | (?:",
					"          \\-",
					"          (?:",
					"              ah|apple|atsc|epub|hp|khtml|moz",
					"            | ms|o|rim|ro|tc|wap|webkit|xv",
					"          )",
					"          | (?:",
					"              mso|prince",
					"            )",
					"        )",
					"        -[a-z-]+",
					"    )",
					"  )",
					")"
				].join("\n"),
				end: SHARED_END,
				patterns: [{include: "#selector"}]
			}
		]
	};

	// -- rule-list-innards: try a nested rule before an unknown property ----------

	var list = repo["rule-list-innards"].patterns;

	var wrappers = list.filter((p) => (
		p.name === "meta.property-name.css"
		&& p.begin === "(?<![-a-zA-Z])(?=[-a-zA-Z])"
		&& p.patterns?.length === 1
		&& p.patterns[0].include === "#property-names"
	));

	if (wrappers.length !== 1 || list.some((p) => p.include === "#selector")) {
		throw new Error(`${grammar.scopeName}: rule-list-innards no longer has exactly one property-name wrapper and no #selector; re-derive patchNesting`);
	}

	// Known property names first, so `color:red` (no space, no `;`) is still a
	// property; then the shared names; then anything selector-shaped; and only
	// then the wrapper, which is left to catch UNKNOWN property names. Its
	// inner include is dropped: every name it could match has already been
	// tried above it.
	list.splice(list.indexOf(wrappers[0]), 0, {include: "#shared-names"}, {include: "#property-names"}, {include: "#selector"});
	delete wrappers[0].patterns;

	// -- rule-list: a nested `{` opens a nested block --------------------------------

	var ruleList = repo["rule-list"].patterns;

	if (ruleList.length !== 1 || ruleList[0].include !== "#rule-list-innards") {
		throw new Error(`${grammar.scopeName}: rule-list no longer dispatches to exactly [#rule-list-innards]; re-derive patchNesting`);
	}

	// `$self` is the top-level pattern list: it brings #rule-list itself (the
	// nested `{`), #at-rules (a nested `@media`), and #selector again.
	ruleList.push({include: "$self"});

	// -- at-rule bodies: declarations directly inside a nested @media -------------

	// The media body and the generic at-rule body (anything without its own
	// rule: @container, @layer, @scope, ...) dispatch to `$self` only, so a
	// declaration written directly inside one is plain text. Nesting makes that
	// the common case. Same two bodies the fork changed.
	var BODIES = ["meta.at-rule.media.body.css", "meta.at-rule.body.css"];

	function bodies(node) {
		if (Array.isArray(node)) {
			return node.flatMap(bodies);
		}
		if (node && typeof node === "object") {
			var self = BODIES.includes(node.name) ? [node] : [];
			return self.concat(Object.values(node).flatMap(bodies));
		}
		return [];
	}

	var found = bodies(repo["at-rules"]);

	if (
		found.length !== BODIES.length
		|| found.some((body) => body.patterns.length !== 1 || body.patterns[0].include !== "$self")
	) {
		throw new Error(`${grammar.scopeName}: at-rules no longer has exactly one each of ${BODIES.join(", ")} dispatching to [$self]; re-derive patchNesting`);
	}

	for (var body of found) {
		body.patterns.unshift({include: "#rule-list-innards"});
	}

	return "nesting";
}

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
*   (including the vendored scope), and `(hover)` in boolean context still
*   reads as a feature. Range syntax `(400px <= width <= 700px)` reaches it
*   through the comparison-operator lookahead.
*
* Consuming the value in a sub-rule is what makes the name rule safe: without
* it, `no-preference` sits before `)` and would read as a feature name.
*/
function patchMediaFeatures(grammar) {
	var query = grammar.repository["media-query"];
	var KEY_VALUE = "punctuation.separator.key-value.css";

	var parens = (query && query.patterns || []).filter((p) => p.begin === "\\(" && p.end === "\\)");

	if (
		!query
		|| query.begin !== "\\G"
		|| query.end !== "(?=\\s*[{;])"
		|| parens.length !== 1
	) {
		throw new Error(`${grammar.scopeName}: media-query no longer has one \\( ... \\) rule; re-derive patchMediaFeatures`);
	}

	var patterns = parens[0].patterns;
	var colons = patterns.filter((p) => p.match === ":" && p.name === KEY_VALUE);

	// The value patterns are looked up by identity so the sub-rule reuses the
	// grammar's own objects. Each must be present exactly once.
	function one(test, label) {
		var found = patterns.filter(test);

		if (found.length !== 1) {
			throw new Error(`${grammar.scopeName}: media-query's paren rule no longer has exactly one ${label}; re-derive patchMediaFeatures`);
		}

		return found[0];
	}

	if (colons.length !== 1) {
		throw new Error(`${grammar.scopeName}: media-query's paren rule no longer has exactly one ${KEY_VALUE} match; re-derive patchMediaFeatures`);
	}

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

	patterns[patterns.indexOf(colons[0])] = {
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

	return "media-features";
}
