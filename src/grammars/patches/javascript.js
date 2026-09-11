/**
* JavaScript and TypeScript patches. Three grammars carry JavaScript rules:
*
*   source.js             starry-night's stock JavaScript, Atom's descendant
*                         of the 2004 javascript.tmbundle
*   source.ts             starry-night's stock TypeScript, Microsoft's grammar
*   embedding.cfml(.cfs)  cfmleditor's inlined copy of Microsoft's JavaScript
*                         rules for <script> bodies, in two repository
*                         contexts each: the general script island and the
*                         copy used inside <cfoutput> blocks
*
*   method-name-lists   every chained method call renders in one color
*   console-global      `console` colors as a global like `document`, and
*                       `console.log(` like any other method call
*   object-keys         object-literal keys color as constants
*   template-property   template strings in `@Component` metadata parse as
*                       HTML (TypeScript)
*   property-names      a property name renders in one color whether
*                       declared, accessed via `this.`, or used as a literal
*                       key (TypeScript)
*
* The cfmleditor copy is Microsoft's lineage, so where it and source.ts need
* the same surgery the branches share a helper; source.js is a different
* grammar and gets its own.
*/

import {CFML_TAG, CFML_SCRIPT} from "../scopes.js";
import {count, find, named} from "./walk.js";

/**
* Chained method calls render in different colors.
*
* Every JavaScript grammar here descends from the same 2004-era
* javascript.tmbundle name lists: a method name after a dot is checked against
* hardcoded rosters of DOM and standard-library names, so a jQuery chain
* alternates colors by accident of naming --
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
* Deliberately KEPT, in every grammar: rules keyed on an actual global
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
* carry, so a CALLED name always falls through to method_calls. The
* Microsoft-lineage grammars (source.ts and the cfmleditor copy) need no
* property rule touched for that reason.
*/
var patchMethodNameLists = {
	name: "method-name-lists",
	branches: new Map([
		["source.js", methodNameListsInJs],
		["source.ts", methodNameListsInTs],
		[CFML_TAG, methodNameListsInCfml],
		[CFML_SCRIPT, methodNameListsInCfml]
	])
};

function methodNameListsInJs(grammar) {
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
		throw new Error(`${grammar.scopeName}: method_calls no longer has the expected name-list shape; re-derive methodNameListsInJs`);
	}

	// Keep only the fallback and the illegal-identifier catch; the three
	// support lists in front of them are the deletion.
	call.patterns[0].beginCaptures[2].patterns = call.patterns[0].beginCaptures[2].patterns.slice(3);

	// The deleted scopes must appear NOWHERE else, or a starry-night upgrade
	// could add a second name-list rule that survives this patch and puts the
	// alternating colors back in some context nobody re-tested.
	// support.function.js legitimately survives ONCE, in function_calls'
	// bare-global list; the other two must be gone entirely.
	if (
		count(grammar, named("support.function.event-handler.js")) !== 0
		|| count(grammar, named("support.function.dom.js")) !== 0
		|| count(grammar, named("support.function.js")) !== 1
	) {
		throw new Error(`${grammar.scopeName}: a dot-method name list now appears outside method_calls; extend methodNameListsInJs to cover it`);
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
			throw new Error(`${grammar.scopeName}: the ${scope} rule no longer has the expected dot-property shape; re-derive methodNameListsInJs`);
		}

		properties[0].match += "(?!\\s*\\()";
	}
}

function methodNameListsInTs(grammar) {
	// Microsoft folded the same rosters into ONE support-objects rule: a
	// single match keyed on a leading `.` or `?.` whose captures assign the
	// four list scopes. Deleting the whole rule drops the name to the
	// generic function-call rule -> entity.name.function.ts.
	var rules = grammar.repository["support-objects"].patterns;
	var EXPECTED = [
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
		|| JSON.stringify(Object.values(matches[0].captures).map((c) => c.name)) !== JSON.stringify(EXPECTED)
		|| !matches[0].match.startsWith("(?x) (?:(\\.)")
	) {
		throw new Error(`${grammar.scopeName}: support-objects no longer has the expected dot-method rule shape; re-derive methodNameListsInTs`);
	}

	rules.splice(rules.indexOf(matches[0]), 1);

	// The deleted scopes must appear NOWHERE else, or a starry-night upgrade
	// could add a second name-list rule that survives this patch and puts the
	// alternating colors back in some context nobody re-tested.
	// support.function.ts legitimately survives ONCE, in the bare-global
	// list (parseInt, setTimeout); the other three must be gone entirely.
	if (
		count(grammar, named("support.function.event-handler.ts")) !== 0
		|| count(grammar, named("support.function.dom.ts")) !== 0
		|| count(grammar, named("support.function.promise.ts")) !== 0
		|| count(grammar, named("support.function.ts")) !== 1
	) {
		throw new Error(`${grammar.scopeName}: a dot-method name list now appears outside support-objects; extend methodNameListsInTs to cover it`);
	}
}

function methodNameListsInCfml(grammar) {
	// Both script-island contexts carry their own copy of the rule: the general
	// one, and the copy used inside <cfoutput> blocks.
	var ENTRIES = [
		"source-js-support-objects",
		"source-js-cfoutput-support-objects"
	];

	var EXPECTED = [
		"punctuation.accessor.js",
		"support.function.event-handler.js",
		"support.function.js",
		"support.function.dom.js"
	];

	for (var entry of ENTRIES) {
		var patterns = grammar.repository[entry].patterns;

		var matches = patterns.filter((p) => p.captures && Object.values(p.captures).some((c) => c.name === "support.function.dom.js"));

		// Anchor check on the exact roster shape. Anything else means the rule
		// was reworked -- re-derive rather than deleting a stranger.
		if (
			matches.length !== 1
			|| JSON.stringify(Object.values(matches[0].captures).map((c) => c.name)) !== JSON.stringify(EXPECTED)
			|| !matches[0].match.startsWith("(?x) (\\.)")
		) {
			throw new Error(`${grammar.scopeName}: ${entry} no longer has the expected dot-method rule shape; re-derive methodNameListsInCfml`);
		}

		patterns.splice(patterns.indexOf(matches[0]), 1);
	}

	// The deleted scopes must be gone entirely, except support.function.js,
	// which legitimately survives ONCE per entry in the bare-global call list
	// (parseInt, setTimeout -- not dot methods). A third carrier appearing in
	// an upstream update would survive this patch and put the alternating
	// colors back in some context nobody re-tested -- fail loudly instead.
	if (
		count(grammar, named("support.function.event-handler.js")) !== 0
		|| count(grammar, named("support.function.dom.js")) !== 0
		|| count(grammar, named("support.function.js")) !== ENTRIES.length
	) {
		throw new Error(`${grammar.scopeName}: a dot-method name list now appears outside ${ENTRIES.join(", ")}; extend methodNameListsInCfml to cover it`);
	}
}

/**
* `console` renders as a type name, and its methods as built-ins.
*
* Every grammar here gives `console` a rule of its own, keyed on the receiver
* and carrying a roster of its methods, and none treats any other global that
* way: `document`, `window`, `navigator` are one entry in a list scoped
* support.variable.dom, and the method after them is whatever the method-call
* rule says. So two adjacent lines render with their colors swapped --
*
*   console.info( "Setup" );                    <-- pl-en . pl-c1 (js)
*                                                   pl-c1 . pl-c1 (ts, cfml)
*   document.addEventListener( "mousedown", f ); <-- pl-c1 . pl-en (all)
*
* -- and a reader has no reason to expect the two globals to differ. The
* patch reduces each console rule to a bare receiver match carrying the same
* support.variable.dom scope the other globals have, so `console` colors like
* `document` and the method after it falls through to the ordinary method-call
* rule like any other. The method roster goes with the rule: `console.table(`
* and `console.log(` are the same kind of thing, and the roster made them
* differ. This DIVERGES from GitHub, which keeps the special rule.
*/
var patchConsoleGlobal = {
	name: "console-global",
	branches: new Map([
		["source.js", consoleGlobalInJs],
		["source.ts", consoleGlobalInTs],
		[CFML_TAG, consoleGlobalInCfml],
		[CFML_SCRIPT, consoleGlobalInCfml]
	])
};

function consoleGlobalInJs(grammar) {
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
		throw new Error(`${grammar.scopeName}: the console rule no longer has the expected begin/end shape; re-derive consoleGlobalInJs`);
	}

	// Same position, same regex, no body: the receiver alone, scoped like
	// `document`. The `.method(` after it is method_calls' business.
	grammar.patterns[grammar.patterns.indexOf(rules[0])] = {
		match: BEGIN,
		name: "support.variable.dom.js"
	};

	// The console scopes must appear NOWHERE else, or a starry-night upgrade
	// could add a second console rule that survives this patch and puts the
	// type-name color back in some context nobody re-tested.
	if (
		count(grammar, named("entity.name.type.object.console.js")) !== 0
		|| count(grammar, named("support.function.console.js")) !== 0
	) {
		throw new Error(`${grammar.scopeName}: a console scope now appears outside the top-level console rule; extend consoleGlobalInJs to cover it`);
	}
}

function consoleGlobalInTs(grammar) {
	// Microsoft's version is one match in support-objects: the receiver,
	// then an optional accessor and method roster. Cut the match after the
	// receiver group and drop the accessor and method captures with it.
	var HEAD = "(?x)(?<![_$[:alnum:]])(?:(?<=\\.\\.\\.)|(?<!\\.))(console)";
	var TAIL = "\\b(?!\\$)";
	var EXPECTED = [
		"support.class.console.ts",
		"punctuation.accessor.ts",
		"punctuation.accessor.optional.ts",
		"support.function.console.ts"
	];
	var objects = grammar.repository["support-objects"].patterns;
	var matches = objects.filter((p) => p.captures && Object.values(p.captures).some((c) => c.name === "support.class.console.ts"));

	if (
		matches.length !== 1
		|| JSON.stringify(Object.values(matches[0].captures).map((c) => c.name)) !== JSON.stringify(EXPECTED)
		|| !matches[0].match.startsWith(HEAD)
		|| !matches[0].match.endsWith(TAIL)
	) {
		throw new Error(`${grammar.scopeName}: the support-objects console rule no longer has the expected shape; re-derive consoleGlobalInTs`);
	}

	matches[0].match = `${HEAD}${TAIL}`;
	matches[0].captures = {
		"1": {
			name: "support.variable.dom.ts"
		}
	};

	// The console scopes must appear NOWHERE else, or a starry-night upgrade
	// could add a second console rule that survives this patch and puts the
	// type-name color back in some context nobody re-tested.
	if (
		count(grammar, named("support.class.console.ts")) !== 0
		|| count(grammar, named("support.function.console.ts")) !== 0
	) {
		throw new Error(`${grammar.scopeName}: a console scope now appears outside support-objects; extend consoleGlobalInTs to cover it`);
	}
}

function consoleGlobalInCfml(grammar) {
	// Both script-island contexts carry their own copy of the rule: the general
	// one, and the copy used inside <cfoutput> blocks. The rule is the same
	// shape as source.ts's, cut the same way: after the receiver group.
	var ENTRIES = [
		"source-js-support-objects",
		"source-js-cfoutput-support-objects"
	];

	var HEAD = "(?x)(?<!\\.|\\$)\\b(console)";
	var TAIL = "\\b(?!\\$)";
	var EXPECTED = [
		"support.class.console.js",
		"punctuation.accessor.js",
		"support.function.console.js"
	];

	for (var entry of ENTRIES) {
		var patterns = grammar.repository[entry].patterns;

		var matches = patterns.filter((p) => p.captures && Object.values(p.captures).some((c) => c.name === "support.class.console.js"));

		// Anchor check on the exact rule shape. Anything else means the rule was
		// reworked -- re-derive rather than cutting into a stranger.
		if (
			matches.length !== 1
			|| JSON.stringify(Object.values(matches[0].captures).map((c) => c.name)) !== JSON.stringify(EXPECTED)
			|| !matches[0].match.startsWith(HEAD)
			|| !matches[0].match.endsWith(TAIL)
		) {
			throw new Error(`${grammar.scopeName}: ${entry} no longer has the expected console rule shape; re-derive consoleGlobalInCfml`);
		}

		matches[0].match = `${HEAD}${TAIL}`;
		matches[0].captures = {
			"1": {
				name: "support.variable.dom.js"
			}
		};
	}

	// The console scopes must be gone entirely. A third carrier appearing in an
	// upstream update would survive this patch and put the class color back in
	// some context nobody re-tested -- fail loudly instead.
	if (
		count(grammar, named("support.class.console.js")) !== 0
		|| count(grammar, named("support.function.console.js")) !== 0
	) {
		throw new Error(`${grammar.scopeName}: a console rule now appears outside ${ENTRIES.join(", ")}; extend consoleGlobalInCfml to cover it`);
	}
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
* The two lineages need different surgery. Microsoft's grammar -- source.ts
* and the cfmleditor copy alike -- already MATCHES bare keys inside
* object-literal regions, with a rule that assigns only a meta scope, which
* the theme maps to nothing; the identifier there just gains a capture. Atom's
* JS grammar has no object-literal context at all (`{` is just punctuation),
* so the patch ADDS a rule: an identifier before a colon, at line start or
* after `{` or `,`. That anchor is what keeps ternary branches (`a ? b : c`
* -- `b` follows `?`) and `case foo:` (`foo` follows a space) unclaimed;
* `default:`/`case:` are excluded by name because a match from the leading
* whitespace would start EARLIER in the line than the switch rules' own
* keyword match, and vscode-textmate awards ties like that to the earliest
* start. The one known false positive is a statement label (`outer: for`),
* which is indistinguishable from a key without a parser.
*/
var patchObjectKeys = {
	name: "object-keys",
	branches: new Map([
		["source.ts", objectKeysInTs],
		["source.js", objectKeysInJs],
		[CFML_TAG, objectKeysInCfml],
		[CFML_SCRIPT, objectKeysInCfml]
	])
};

// The bare-identifier key rule in a Microsoft-lineage grammar is the one
// whose ONLY capture assigns the meta key scope to the whole match.
function bareKeyCarrier(meta) {
	return (node) => (
		node.captures
		&& Object.keys(node.captures).length === 1
		&& node.captures[0]
		&& node.captures[0].name === meta
	);
}

// Promote the identifier's non-capturing group to group 1 and scope it. The
// whole-match meta scope stays, mirroring upstream's own numeric-key and
// function-key siblings.
function promoteBareKey(rule, scope) {
	rule.match = `(${rule.match.slice("(?:".length)}`;
	rule.captures[1] = {name: scope};
}

var BARE_KEY_IDENTIFIER = "(?:[_$[:alpha:]][_$[:alnum:]]*)";

function objectKeysInTs(grammar) {
	var carriers = find(grammar, bareKeyCarrier("meta.object-literal.key.ts"));

	// Anchor check: exactly one such rule, with the identifier still spelled
	// the way the rewrap expects. More carriers, or a reshaped match, means
	// object members were reworked -- re-derive rather than guessing which one
	// is the key rule.
	if (
		carriers.length !== 1
		|| !carriers[0].match.startsWith(BARE_KEY_IDENTIFIER)
	) {
		throw new Error(`${grammar.scopeName}: the object-key rule no longer has the expected shape; re-derive objectKeysInTs`);
	}

	promoteBareKey(carriers[0], "constant.other.object.key.ts");
}

function objectKeysInJs(grammar) {
	// Nothing in the grammar may already assign the scope this rule adds --
	// a second claimant appearing in a starry-night upgrade would mean keys
	// are now scoped twice, each in contexts nobody re-tested.
	if (count(grammar, named("constant.other.object.key.js")) !== 0) {
		throw new Error(`${grammar.scopeName}: upstream now scopes object keys itself; remove or re-derive objectKeysInJs`);
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
}

function objectKeysInCfml(grammar) {
	// Both script-island contexts carry their own copy of the rule: the general
	// one, and the copy used inside <cfoutput> blocks.
	var ENTRIES = [
		"source-js-object-member",
		"source-js-cfoutput-object-member"
	];

	var isCarrier = bareKeyCarrier("meta.object-literal.key.js");

	for (var entry of ENTRIES) {
		var matches = grammar.repository[entry].patterns.filter(isCarrier);

		// Anchor check: exactly one such rule per entry, with the identifier
		// still spelled the way the rewrap expects.
		if (
			matches.length !== 1
			|| !matches[0].match.startsWith(BARE_KEY_IDENTIFIER)
		) {
			throw new Error(`${grammar.scopeName}: ${entry} no longer has the expected object-key rule shape; re-derive objectKeysInCfml`);
		}

		promoteBareKey(matches[0], "constant.other.object.key.js");
	}

	// ENTRIES must be the ONLY carriers of the bare-key shape. A third
	// appearing in an upstream update would survive this patch and keep plain
	// keys in some context nobody re-tested -- fail loudly instead.
	if (count(grammar, isCarrier) !== 0) {
		throw new Error(`${grammar.scopeName}: a bare object-key rule now appears outside ${ENTRIES.join(", ")}; extend objectKeysInCfml to cover it`);
	}
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
var patchTemplateProperty = {
	name: "template-property",
	branches: new Map([
		["source.ts", templatePropertyInTs]
	])
};

function templatePropertyInTs(grammar) {
	var LITERAL = "object-literal";

	// Every repository entry the new rule hands content to must exist, or the
	// rule would carry an unresolvable include -- which vscode-textmate answers
	// by disabling the whole rule, silently.
	for (var required of ["object-member", "expression", "template-substitution-element", "string-character-escape"]) {
		if (!grammar.repository[required]) {
			throw new Error(`${grammar.scopeName}: repository no longer has ${required}; re-derive templatePropertyInTs`);
		}
	}

	var literal = grammar.repository[LITERAL];

	// Anchor check: the dispatch being cut in front of must still have its
	// upstream shape. Anything else means object literals were reworked --
	// re-derive the patch against the new shape rather than unshifting into a
	// list that no longer means what it did.
	if (literal.patterns.length !== 1 || literal.patterns[0].include !== "#object-member") {
		throw new Error(`${grammar.scopeName}: ${LITERAL} no longer dispatches to exactly [#object-member]; re-derive templatePropertyInTs`);
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
var patchPropertyNames = {
	name: "property-names",
	branches: new Map([
		["source.ts", propertyNamesInTs]
	])
};

function propertyNamesInTs(grammar) {
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
	for (var node of find(grammar, (n) => typeof n.name === "string")) {
		var scopes = node.name.split(" ");

		// If upstream starts assigning this scope themselves, remove this
		// patch rather than stacking a second copy on theirs.
		if (scopes.includes(ADDED)) {
			throw new Error(`${grammar.scopeName}: upstream now scopes ${ADDED} itself; remove or re-derive propertyNamesInTs`);
		}

		for (var scope of scopes) {
			if (found.has(scope)) {
				found.set(scope, found.get(scope) + 1);
				node.name = `${node.name} ${ADDED}`;
			}
		}
	}

	for (var [scope, expected] of EXPECTED) {
		if (found.get(scope) !== expected) {
			throw new Error(`${grammar.scopeName}: ${scope} now has ${found.get(scope)} carriers, expected ${expected}; re-derive propertyNamesInTs`);
		}
	}
}

// Last in the file: `var` hoists the binding, not the value, so this list has
// to follow the descriptors it names.
export var PATCHES = [patchMethodNameLists, patchConsoleGlobal, patchObjectKeys, patchTemplateProperty, patchPropertyNames];
