/**
* CFML patches: rules that are cfmleditor's own, in both vendored grammars
* (`embedding.cfml` for tag files, `embedding.cfml.cfs` for script). The
* HTML, JavaScript and SQL rules those grammars inline are patched in their
* own family modules beside this one.
*
*   bare-include        `include "path";` colors as a tag statement
*   safe-navigation     the `?.` operator colors as an operator
*   tag-island          Lucee tag islands highlight as tags anywhere in a
*                       script, including function bodies and script-based
*                       components
*   custom-tag-digits   digits in custom tag names are not errors
*   function-metadata   call expressions in function metadata highlight as
*                       expressions, not errors
*/

import {CFML_TAG, CFML_SCRIPT} from "../scopes.js";

/**
* `include "path";` renders unstyled.
*
* cfmleditor DOES list `include` among the tag-in-script names, scoped
* `entity.name.tag.script.cfml`. But that rule is a `begin` whose lookahead
* requires an identifier or a brace after the tag name:
*
*   (?=\s+[a-zA-Z0-9:-]+\s*(?:[=;{]|$)|\s*(?:\{|$))
*
* A quote is not in `[a-zA-Z0-9:-]`, so only these work:
*
*   include template="/core/cfmlx.cfm";   -> pl-ent
*   include somePathVariable;             -> pl-ent
*   include "/core/cfmlx.cfm";            -> pl-smi   <-- the bare form
*
* The bare statement falls through to the generic identifier rule in
* `source-cfml-script-expressions` and lands on `variable.other` -> `pl-smi`,
* which resolves to GitHub's DEFAULT TEXT COLOUR. So it is not unclassed; it is
* classed as deliberately-unemphasised, which reads as broken.
*
* Confirmed worth fixing rather than tolerating: GitHub's own rendering of this
* form -- read off a live gist from the archive on 2026-08-06 -- is `pl-ent`.
* This patch matches GitHub rather than inventing a convention.
*
* Why the rule wins, measured rather than assumed:
*
* `source-cfml-script-statements` consults `#source-cfml-script-tag-in-script`
* before `#source-cfml-script-expressions`. Both can claim `include` at the same
* offset, and TextMate breaks that tie by pattern order -- so the ENTRY we add
* to is reached first and the identifier rule never gets a look. Swapping those
* two entries flips this token from pl-ent to pl-smi, which is why
* `bareIncludeInCfml` asserts the ordering: upstream could reorder them and the
* patch would keep "applying" while doing nothing.
*
* Position WITHIN the entry is irrelevant here -- unshift and push both produce
* pl-ent, because nothing else in tag-in-script matches this input. `unshift` is
* used only so the local patch reads first when someone opens the array.
*/
var patchBareInclude = {
	name: "bare-include",
	branches: new Map([
		[CFML_TAG, bareIncludeInCfml],
		[CFML_SCRIPT, bareIncludeInCfml]
	])
};

function bareIncludeInCfml(grammar) {
	var ORDER = "source-cfml-script-statements";
	var TARGET = "source-cfml-script-tag-in-script";

	var order = grammar.repository[ORDER].patterns;
	var target = grammar.repository[TARGET].patterns;

	var tagIndex = order.findIndex((p) => p.include === `#${TARGET}`);
	var exprIndex = order.findIndex((p) => p.include === "#source-cfml-script-expressions");

	if (tagIndex < 0 || exprIndex < 0) {
		throw new Error(`${grammar.scopeName}: ${ORDER} no longer includes both tag-in-script and expressions; re-derive bareIncludeInCfml`);
	}

	if (tagIndex > exprIndex) {
		throw new Error(
			`${grammar.scopeName}: expressions (${exprIndex}) now precedes tag-in-script (${tagIndex}); ` +
			"bareIncludeInCfml can no longer win on pattern order"
		);
	}

	// Anchor check: the upstream rule we are compensating for must still exist,
	// so this patch is removed rather than duplicated once upstream fixes it.
	var upstreamHandlesIt = target.some((p) =>
		typeof p.begin === "string" && /\|include\|/.test(p.begin)
	);

	if (!upstreamHandlesIt) {
		throw new Error(`${grammar.scopeName}: the tag-in-script alternation no longer lists 'include'; upstream may have fixed it -- remove bareIncludeInCfml rather than duplicating`);
	}

	target.unshift({
		match: "(?i)\\b(include)\\b(?=\\s*[\"'])",
		captures: {1: {name: "entity.name.tag.script.cfml"}}
	});
}

/**
* `?.` safe navigation -- CF2018. cfmleditor has no rule for it, so neither
* character is claimed by anything and the operator renders as plain text.
*
* This is the one construct the old 2013 grammar handled BETTER, because we had
* patched it there. Carried across so the swap is not a regression: it was
* `pl-k` before and it is `pl-k` after.
*
* Scoped as an operator, which puts it alongside `=` and `&&`.
*/
var patchSafeNavigation = {
	name: "safe-navigation",
	branches: new Map([
		[CFML_TAG, safeNavigationInCfml],
		[CFML_SCRIPT, safeNavigationInCfml]
	])
};

function safeNavigationInCfml(grammar) {
	var TARGET = "source-cfml-script-operators";

	var target = grammar.repository[TARGET].patterns;

	// Anchor check. If upstream adds its own rule this patch becomes a duplicate
	// that shadows theirs -- delete it rather than leave two rules racing.
	var upstreamHandlesIt = target.some((p) =>
		typeof p.match === "string" && p.match.includes("\\?\\.")
	);

	if (upstreamHandlesIt) {
		throw new Error(
			`${grammar.scopeName}: ${TARGET} now has its own '?.' rule; ` +
			"remove safeNavigationInCfml rather than shadowing it"
		);
	}

	target.unshift({
		match: "\\?\\.",
		name: "keyword.operator.safe-navigation.cfml"
	});
}

/**
* Lucee tag islands -- tag syntax embedded in cfscript between ``` fences --
* render as a wall of errors in script files. Without a rule for the fence,
* island content falls through to the tag-in-script rules: the opening tag's
* `<` reads as an operator, and after its `>` the parser stays in the
* attribute scanner, rendering a cfquery body as attribute names (`pl-e`)
* and, for anything an attribute name cannot contain,
* `invalid.illegal.attribute-name.cfml` -- `pl-ii`, white on red. SQL like
* `t.id,` lit up as errors is how this was noticed.
*
* The rule itself is not ours -- it is UPSTREAM'S. cfml.tmLanguage.json
* carries `source-cfml-script-tagisland` and wires it into
* `source-cfml-script-main`. But upstream ships two gaps, both patched here:
*
*   1. The cfs build lacks the rule ENTIRELY -- no repository entry, no
*      include -- so a script-based component gets no island handling at all.
*      The entry is copied in verbatim, and where a file already carries it,
*      the copy is ASSERTED against the original on every load: if upstream
*      evolves the rule, the load fails and says to re-copy rather than drift.
*
*   2. In BOTH files the include sits only in `main`, the top-of-script
*      dispatch -- so an island works at the top of a <cfscript> block and
*      nowhere else. Function bodies, blocks, and struct literals dispatch
*      through `source-cfml-script-statements`, never through main. An
*      island inside a function -- where a cfquery actually lives -- fell
*      through to the tag-in-script attribute scanner in upstream's own tag
*      grammar. The include is added to the statements dispatch, which every
*      one of those contexts reaches.
*
* One function for both grammars, on purpose. Which gap applies is decided by
* whether the repository already carries the entry, not by scope name, so if
* upstream ever adds the rule to the cfs build this falls into the fidelity
* check on its own instead of overwriting their copy.
*/
var patchTagIsland = {
	name: "tag-island",
	branches: new Map([
		[CFML_TAG, tagIslandInCfml],
		[CFML_SCRIPT, tagIslandInCfml]
	])
};

function tagIslandInCfml(grammar) {
	var ISLAND = "source-cfml-script-tagisland";
	var STATEMENTS = "source-cfml-script-statements";

	// Verbatim copy of the rule in cfml.tmLanguage.json, key order included --
	// the fidelity check below compares serialized forms.
	var rule = {
		begin: "(```)",
		contentName: "source.cfml",
		end: "(```)",
		patterns: [
			{include: "#cfml-tags"},
			{include: "#text-html-cfml"}
		]
	};

	var statements = grammar.repository[STATEMENTS].patterns;
	var existing = grammar.repository[ISLAND];

	if (existing) {
		// The tag grammar. Nothing to install, but the copy above must still
		// match what it was copied from.
		if (JSON.stringify(existing) !== JSON.stringify(rule)) {
			throw new Error(`${grammar.scopeName}: ${ISLAND} no longer matches the copy in tagIslandInCfml; re-copy it rather than letting the two files drift`);
		}
	} else {
		// The cfs grammar. The island body is handed entirely to these two
		// includes, so the port is only sound while the file inlines both.
		for (var required of ["cfml-tags", "text-html-cfml"]) {
			if (!grammar.repository[required]) {
				throw new Error(`${grammar.scopeName}: repository no longer has ${required}; tagIslandInCfml has nothing to hand the island body to`);
			}
		}

		grammar.repository[ISLAND] = rule;
	}

	// If upstream wires the statements dispatch themselves, this patch shrinks
	// to the fidelity check above -- delete the push rather than duplicating
	// their include.
	if (statements.some((p) => p.include === `#${ISLAND}`)) {
		throw new Error(`${grammar.scopeName}: ${STATEMENTS} now includes ${ISLAND} itself; shrink tagIslandInCfml accordingly`);
	}

	// Appended, not unshifted. TextMate awards a position to the rule that
	// matches EARLIEST at it, using list order only to break ties, and nothing
	// else in the statement rules claims a backtick -- so the fence is won by
	// the island rule even from the back of the list, where it cannot get in
	// front of a real statement rule on some other input.
	statements.push({include: `#${ISLAND}`});
}

/**
* Digits in a custom-tag name render as invalid.illegal -> pl-ii.
*
* Custom tag names may contain digits -- `<html:h1>` from a cfimport prefix,
* or `<cf_h1>` -- but every name class in cfmleditor's `custom-tags` rules is
* `[a-z_-]`. The begin match stops at the digit (`<html:h` of `<html:h1`),
* the digit is left for the tag's attribute patterns, and no attribute rule
* claims a bare digit, so it lands on invalid.illegal.attribute-name.cfml:
* white on red, in the middle of a tag name. Found by the archive pl-ii sweep
* (post 3982, fixture 3982-1.cfm).
*
* The patch widens each name class to `[a-z0-9_-]`, nothing else. The prefix
* class (`[a-z]+` before the colon) is left alone: no archive input needs it,
* and widening an anchor that DECIDES whether the rule matches at all -- rather
* than where the name ends -- would change what the rule claims.
*
* Each rewrite is keyed on the full upstream regex, so any upstream edit to
* these rules -- including fixing this -- makes the lookup miss and the load
* throw, rather than silently re-widening a pattern that no longer needs it.
*/
var patchCustomTagDigits = {
	name: "custom-tag-digits",
	branches: new Map([
		[CFML_TAG, customTagDigitsInCfml],
		[CFML_SCRIPT, customTagDigitsInCfml]
	])
};

function customTagDigitsInCfml(grammar) {
	var TARGET = "custom-tags";

	var REWRITES = new Map([
		["(?i)(<)(cf_[a-z_-]*)", "(?i)(<)(cf_[a-z0-9_-]*)"],
		["(?i)(</)(cf_[a-z_-]*)(>)", "(?i)(</)(cf_[a-z0-9_-]*)(>)"],
		["(?i)(<)([a-z]+)(\\:)([a-z_-]*)", "(?i)(<)([a-z]+)(\\:)([a-z0-9_-]*)"],
		["(?i)(</)([a-z]+\\:[a-z_-]*)(>)", "(?i)(</)([a-z]+\\:[a-z0-9_-]*)(>)"]
	]);

	var patterns = grammar.repository[TARGET].patterns;
	var rewritten = 0;

	for (var pattern of patterns) {
		var key = pattern.begin ?? pattern.match;

		if (!REWRITES.has(key)) {
			continue;
		}

		if (pattern.begin) {
			pattern.begin = REWRITES.get(key);
		} else {
			pattern.match = REWRITES.get(key);
		}

		rewritten++;
	}

	if (rewritten !== REWRITES.size) {
		throw new Error(`${grammar.scopeName}: only ${rewritten} of ${REWRITES.size} ${TARGET} rules matched customTagDigitsInCfml; upstream changed them -- re-derive the rewrites or remove the patch`);
	}
}

/**
* Call expressions in function metadata render as invalid.illegal -> pl-ii.
*
* CFML allows attribute metadata between a script function's signature and its
* body, and the values can be full expressions:
*
*   public void function writeResponse() cachedWithin = createTimeSpan( 0, 0, 1, 0 ) {
*
* Upstream hands that region to `source-cfml-script-tag-generic-attribute`,
* whose unquoted-value regex stops at whitespace -- it eats `createTimeSpan(`
* as one string and leaves ` 0, 0, 1, 0 )` to the `\S+` catch-all:
* invalid.illegal.attribute-name.cfml, white on red, on every argument. Found
* by the archive pl-ii sweep (post 3655, fixture 3655-2.cfm).
*
* Upstream also ships the fix, one entry over. Tag-in-script statements use
* `source-cfml-script-tag-generic-attribute-script`, an expression-aware twin
* that hands everything after `=` to `#source-cfml-script-expressions` until
* the next `name =` -- which is why `content variable = charsetDecode( ... )`
* in the SAME fixture renders perfectly. The patch re-points the metadata
* region's one include at that twin. Nothing is added and no new claim is
* made; the region keeps upstream's own boundaries (`)` to `{`, `;`, or `=>`).
*/
var patchFunctionMetadata = {
	name: "function-metadata",
	branches: new Map([
		[CFML_TAG, functionMetadataInCfml],
		[CFML_SCRIPT, functionMetadataInCfml]
	])
};

function functionMetadataInCfml(grammar) {
	var TARGET = "source-cfml-script-function-declaration-parameters";
	var FROM = "#source-cfml-script-tag-generic-attribute";
	var TO = "#source-cfml-script-tag-generic-attribute-script";

	// The entry being pointed at must exist, or the metadata region would be
	// handed to an unresolvable include -- which vscode-textmate answers by
	// disabling the whole rule, silently.
	if (!grammar.repository[TO.slice(1)]) {
		throw new Error(`${grammar.scopeName}: repository no longer has ${TO.slice(1)}; functionMetadataInCfml has nothing to point at`);
	}

	var patterns = grammar.repository[TARGET].patterns;

	var region = patterns.filter((p) => p.begin === "\\)");

	// The anchor is the region's exact upstream shape: one post-signature
	// region, containing only the include being replaced. Anything else means
	// upstream reworked function metadata -- re-derive the patch against the
	// new shape rather than swapping an include inside a rule that no longer
	// means what it did.
	if (region.length !== 1 || region[0].patterns.length !== 1 || region[0].patterns[0].include !== FROM) {
		throw new Error(`${grammar.scopeName}: the ${TARGET} post-signature region no longer carries exactly [${FROM}]; re-derive functionMetadataInCfml`);
	}

	region[0].patterns[0].include = TO;
}

// Last in the file: `var` hoists the binding, not the value, so this list has
// to follow the descriptors it names.
export var PATCHES = [patchBareInclude, patchSafeNavigation, patchTagIsland, patchCustomTagDigits, patchFunctionMetadata];
