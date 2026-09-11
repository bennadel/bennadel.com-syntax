/**
* The CFML grammars this service ships, plus the token patches they need.
*
* SOURCE AND VERSION
*
*   https://github.com/cfmleditor/cfmleditor (MIT), syntaxes/ on `master`
*   commit 8af4a78ebc7096224d7d3ec080fe7672badca1d6, 2025-02-18
*   downloaded 2026-08-05
*
*   cfml.tmLanguage.json      sha256 61e7d83cc25ab53816ea427175acb2e8e5ce96f78cb098a3fe2e5fbf3b88de42
*   cfml-cfs.tmLanguage.json  sha256 e3681da75d487b39d5f1ba0e05d28cbbabbc869189582f4828c6c645d9d6207e
*
* Both files are byte-identical to upstream and must STAY that way -- see
* "LOCAL PATCHES" below. That is enforced, not assumed: test/corpus.test.js
* hashes both files on every run and fails if either changed. The hashes are
* recorded in three places on purpose -- here, in the test (which must not
* import them from this file, or it would be checking the code's claim against
* itself), and in LICENSES/README.md.
*
* LICENSE AND PROVENANCE
*
* MIT, Copyright (c) 2017 KamasamaK. The full notice, the upstream copyright,
* and the step-by-step update procedure are in ../../LICENSES/ -- see
* LICENSES/cfmleditor-MIT.txt and LICENSES/README.md. Those live at the repo
* root rather than beside these files because they are a record for THIS
* REPOSITORY; the deployment zip does not carry them, and does not need to,
* since it is never conveyed to a third party.
*
* WHY THESE AND NOT LINGUIST'S
*
* Linguist vendors `SublimeText/ColdFusion`, whose cfscript file was last
* touched 2013-06-25. ColdFusion kept moving and the grammar did not, so the
* archive's most common language was being highlighted by a grammar a decade
* behind it. cfmleditor is the actively maintained CFML grammar, which is the
* whole argument: not that it is better today, but that it will still be right
* in five years.
*
* WHAT WE GAINED, MEASURED
*
*   `final var X = 1`        was pl-smi inside a tag file, now pl-k everywhere
*   `queryExecute( "..." )`  the SQL is embedded and highlighted as SQL
*   return types, struct keys, and built-in functions get distinct scopes
*
* WHAT WE GAVE UP
*
* Exact parity with GitHub for CFML. GitHub renders CFML with the same stale
* Linguist grammar we just left, so matching it and being correct are now
* different things, and we chose correct. This is the same trade refineScope()
* in core/highlight.js already makes for tag-based `.cfc` files, and the reason
* the project exists: GitHub's CFML is out of reach, self-hosted it is a file.
*
* NO EXTERNAL DEPENDENCIES
*
* Both declare ZERO external includes -- everything, SQL and JavaScript
* included, is inlined into ~270 repository entries per file. That is why each
* is ~600 KB against Linguist's 25.5 KB cfscript, and it is also why they need
* no `dependencies` and cannot be broken by an unrelated grammar changing.
*
* It is also what makes the patches below reach EVERYWHERE. The old wrapper
* grammar (`source.cfscript.patched`, deleted with this change) could only
* patch blocks where we picked the entry grammar; it could not reach cfscript
* nested inside a tag file, because `text.html.cfm` included `source.cfscript`
* by name. With everything inlined there is no include chain to lose, so a
* patch applied to the file applies to every context in it.
*/

import {readFile} from "node:fs/promises";

var DIR = new URL("./", import.meta.url);

/** Tag-based CFML: `.cfm` files, and `.cfc` files written with tags. */
export var CFML_TAG = "embedding.cfml";

/** Script-based CFML: `cfscript` blocks and script-style `.cfc` components. */
export var CFML_SCRIPT = "embedding.cfml.cfs";

/**
* file -> [patch names]. Exported so the test suite can assert that every patch
* actually ran, rather than trusting that it did.
*/
export var applied = new Map();

var PATCHES = [patchBareInclude, patchSafeNavigation, patchTagIsland, patchBadAmpersand, patchCustomTagDigits, patchFunctionMetadata, patchCommentHyphens, patchBadAngleBracket, patchDoctypeCapture, patchMethodNameLists, patchConsoleGlobal, patchObjectKeys, patchSqlColumnWords, patchSqlDdlWords];

export async function loadCfmlGrammars() {
	return Promise.all([
		load("cfml.tmLanguage.json"),
		load("cfml-cfs.tmLanguage.json")
	]);
}

/**
* `names` and `extensions` are emptied deliberately.
*
* Leaving cfmleditor's own lists in place would make these grammars resolvable
* straight from a fence tag, racing Linguist's registrations for the same names
* with no stated winner. Every route into these scopes is instead an explicit
* entry in `flagOverrides` (src/core/highlight.js), so the mapping is readable in one
* place and a tag cannot start resolving here by accident.
*
* `dependencies` is emptied because there genuinely are none -- these grammars
* inline everything they use. `missingScopes()` at boot confirms it.
*/
async function load(file) {
	var raw = await readFile(new URL(file, DIR), "utf8");
	var grammar = JSON.parse(raw);

	applied.set(file, PATCHES.map((patch) => patch(grammar, file)));

	return {...grammar, names: [], extensions: [], dependencies: []};
}

/**
* LOCAL PATCHES -- applied at load time, never written to the vendored file.
*
* The vendored JSON stays byte-identical to upstream. That is the whole point:
* a 606 KB, 15,510-line generated-looking file cannot be meaningfully diffed or
* merged, so hand-editing it would make every future update a conflict against
* something unreadable. Instead each patch is a named function with a stated
* anchor, and updating upstream is a re-download plus the test suite.
*
* Every patch ASSERTS its anchor before mutating, and every assertion covers a
* condition that would otherwise fail SILENTLY. A patch that stops applying is
* worse than no patch -- it looks fixed and is not.
*
* Patch TOKENS here, never STRUCTURE. A structural gap is evidence for adopting
* a better grammar, not for writing a cleverer regex: a claim like "the first
* argument of this call is SQL" is about the parse tree, and no pattern match
* placed near the call site can make it soundly.
*/

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
* at index 3 and `#source-cfml-script-expressions` at index 5. Both can claim
* `include` at the same offset, and TextMate breaks that tie by pattern order --
* so the ENTRY we add to is reached first and the identifier rule never gets a
* look. Swapping those two entries flips this token from pl-ent to pl-smi, which
* is why the ordering is asserted below: upstream could reorder them and the
* patch would keep "applying" while doing nothing.
*
* Position WITHIN the entry is irrelevant here -- unshift and push both produce
* pl-ent, because nothing else in tag-in-script matches this input. `unshift` is
* used only so the local patch reads first when someone opens the array.
*/
function patchBareInclude(grammar, file) {
	var ORDER = "source-cfml-script-statements";
	var TARGET = "source-cfml-script-tag-in-script";

	// Deliberately unguarded. If upstream renames either entry this throws a
	// TypeError naming the exact expression, file and line -- strictly more
	// precise than a hand-written message, and it cannot drift out of sync with
	// the code the way one can.
	var order = grammar.repository[ORDER].patterns;
	var target = grammar.repository[TARGET].patterns;

	var tagIndex = order.findIndex((p) => p.include === `#${TARGET}`);
	var exprIndex = order.findIndex((p) => p.include === "#source-cfml-script-expressions");

	if (tagIndex < 0 || exprIndex < 0) {
		throw new Error(`${file}: ${ORDER} no longer includes both tag-in-script and expressions`);
	}

	if (tagIndex > exprIndex) {
		throw new Error(
			`${file}: expressions (${exprIndex}) now precedes tag-in-script (${tagIndex}); ` +
			"the bare-include patch can no longer win on pattern order"
		);
	}

	// Anchor check: the upstream rule we are compensating for must still exist,
	// so this patch is removed rather than duplicated once upstream fixes it.
	var upstreamHandlesIt = target.some((p) =>
		typeof p.begin === "string" && /\|include\|/.test(p.begin)
	);

	if (!upstreamHandlesIt) {
		throw new Error(`${file}: the tag-in-script alternation no longer lists 'include'`);
	}

	target.unshift({
		match: "(?i)\\b(include)\\b(?=\\s*[\"'])",
		captures: {1: {name: "entity.name.tag.script.cfml"}}
	});

	return "bare-include";
}

/**
* `?.` safe navigation -- CF2018. cfmleditor has no rule for it, so neither
* character is claimed by anything and the operator renders as plain text.
*
* This is the one construct the old 2013 grammar handled BETTER, because we had
* patched it there. Carried across so the swap is not a regression: it was
* `pl-k` before and it is `pl-k` after.
*
* Scoped as an operator, which puts it alongside `=` and `&&`. The rule is a
* single-line `match` with no state -- the only kind that belongs in a patch.
*/
function patchSafeNavigation(grammar, file) {
	var TARGET = "source-cfml-script-operators";

	// Unguarded for the same reason as above: a rename throws a TypeError that
	// names the expression.
	var target = grammar.repository[TARGET].patterns;

	// Anchor check. If upstream adds its own rule this patch becomes a duplicate
	// that shadows theirs -- delete it rather than leave two rules racing.
	var upstreamHandlesIt = target.some((p) =>
		typeof p.match === "string" && p.match.includes("\\?\\.")
	);

	if (upstreamHandlesIt) {
		throw new Error(
			`${file}: ${TARGET} now has its own '?.' rule; ` +
			"remove patchSafeNavigation rather than shadowing it"
		);
	}

	target.unshift({
		match: "\\?\\.",
		name: "keyword.operator.safe-navigation.cfml"
	});

	return "safe-navigation";
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
*      through `source-cfml-script-statements` (fifteen include sites,
*      measured), never through main. An island inside a function -- where a
*      cfquery actually lives -- fell through to the tag-in-script attribute
*      scanner in upstream's own tag grammar. The include is added to the
*      statements dispatch, which every one of those contexts reaches.
*
* A begin/end rule, which "patch TOKENS, never STRUCTURE" above reads as
* forbidding. The prohibition is against structural claims a lexer cannot
* soundly make; this is upstream's own structure, re-wired to where the
* content actually occurs, and it makes no new parse claim at all.
*/
function patchTagIsland(grammar, file) {
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

	// Unguarded for the same reason as the patches above: a rename throws a
	// TypeError that names the expression.
	var statements = grammar.repository[STATEMENTS].patterns;
	var existing = grammar.repository[ISLAND];

	if (existing) {
		// The tag grammar. Nothing to install, but the copy above must still
		// match what it was copied from.
		if (JSON.stringify(existing) !== JSON.stringify(rule)) {
			throw new Error(`${file}: ${ISLAND} no longer matches the copy in patchTagIsland; re-copy it rather than letting the two files drift`);
		}
	} else {
		// The cfs grammar. The island body is handed entirely to these two
		// includes, so the port is only sound while the file inlines both.
		for (var required of ["cfml-tags", "text-html-cfml"]) {
			if (!grammar.repository[required]) {
				throw new Error(`${file}: repository no longer has ${required}; the tag-island rule has nothing to hand the island body to`);
			}
		}

		grammar.repository[ISLAND] = rule;
	}

	// If upstream wires the statements dispatch themselves, this patch shrinks
	// to the fidelity check above -- delete the push rather than duplicating
	// their include.
	if (statements.some((p) => p.include === `#${ISLAND}`)) {
		throw new Error(`${file}: ${STATEMENTS} now includes ${ISLAND} itself; shrink patchTagIsland accordingly`);
	}

	// Appended, not unshifted. TextMate awards a position to the rule that
	// matches EARLIEST at it, using list order only to break ties, and nothing
	// else in the statement rules claims a backtick -- so the fence is won by
	// the island rule even from the back of the list, where it cannot get in
	// front of a real statement rule on some other input.
	statements.push({include: `#${ISLAND}`});

	return "tag-island";
}

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
function patchBadAmpersand(grammar, file) {
	// Both HTML-content contexts carry their own copy of the rule set: the
	// general one, and the twin used inside <cfoutput> blocks.
	var ENTRIES = [
		"text-html-cfml-character-reference",
		"text-html-cfml-cfoutput-character-reference"
	];

	var CATCH_ALL = "invalid.illegal.bad-ampersand.html";

	for (var entry of ENTRIES) {
		// Unguarded for the same reason as the patches above: a rename throws a
		// TypeError that names the expression.
		var patterns = grammar.repository[entry].patterns;

		var index = patterns.findIndex((p) => p.name === CATCH_ALL && p.match === "&");

		// Anchor check. If upstream drops the catch-all themselves, remove this
		// patch rather than leaving it to fail silently against nothing.
		if (index < 0) {
			throw new Error(`${file}: ${entry} no longer carries the ${CATCH_ALL} catch-all; remove patchBadAmpersand`);
		}

		patterns.splice(index, 1);
	}

	// The two entries above must be the ONLY carriers. A third copy appearing
	// elsewhere in an upstream update would survive this patch and put pl-ii
	// ampersands back in some context nobody re-tested -- fail loudly instead.
	if (JSON.stringify(grammar.repository).includes(CATCH_ALL)) {
		throw new Error(`${file}: ${CATCH_ALL} now appears outside the two character-reference entries; extend patchBadAmpersand to cover it`);
	}

	return "bad-ampersand";
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
function patchCustomTagDigits(grammar, file) {
	var TARGET = "custom-tags";

	var REWRITES = new Map([
		["(?i)(<)(cf_[a-z_-]*)", "(?i)(<)(cf_[a-z0-9_-]*)"],
		["(?i)(</)(cf_[a-z_-]*)(>)", "(?i)(</)(cf_[a-z0-9_-]*)(>)"],
		["(?i)(<)([a-z]+)(\\:)([a-z_-]*)", "(?i)(<)([a-z]+)(\\:)([a-z0-9_-]*)"],
		["(?i)(</)([a-z]+\\:[a-z_-]*)(>)", "(?i)(</)([a-z]+\\:[a-z0-9_-]*)(>)"]
	]);

	// Unguarded for the same reason as the patches above: a rename throws a
	// TypeError that names the expression.
	var patterns = grammar.repository[TARGET].patterns;
	var applied = 0;

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

		applied++;
	}

	if (applied !== REWRITES.size) {
		throw new Error(`${file}: only ${applied} of ${REWRITES.size} ${TARGET} rules matched patchCustomTagDigits; upstream changed them -- re-derive the rewrites or remove the patch`);
	}

	return "custom-tag-digits";
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
function patchFunctionMetadata(grammar, file) {
	var TARGET = "source-cfml-script-function-declaration-parameters";
	var FROM = "#source-cfml-script-tag-generic-attribute";
	var TO = "#source-cfml-script-tag-generic-attribute-script";

	// The entry being pointed at must exist, or the metadata region would be
	// handed to an unresolvable include -- which vscode-textmate answers by
	// disabling the whole rule, silently.
	if (!grammar.repository[TO.slice(1)]) {
		throw new Error(`${file}: repository no longer has ${TO.slice(1)}; patchFunctionMetadata has nothing to point at`);
	}

	// Unguarded for the same reason as the patches above: a rename throws a
	// TypeError that names the expression.
	var patterns = grammar.repository[TARGET].patterns;

	var region = patterns.filter((p) => p.begin === "\\)");

	// The anchor is the region's exact upstream shape: one post-signature
	// region, containing only the include being replaced. Anything else means
	// upstream reworked function metadata -- re-derive the patch against the
	// new shape rather than swapping an include inside a rule that no longer
	// means what it did.
	if (region.length !== 1 || region[0].patterns.length !== 1 || region[0].patterns[0].include !== FROM) {
		throw new Error(`${file}: the ${TARGET} post-signature region no longer carries exactly [${FROM}]; re-derive patchFunctionMetadata`);
	}

	region[0].patterns[0].include = TO;

	return "function-metadata";
}

/**
* `--` inside an HTML comment renders as invalid.illegal -> pl-ii.
*
* The comment rule in both HTML-content contexts ends with a catch-all that
* brands every `--` before the closing `-->` illegal. That outlaws the
* archive's own house style, the hyphen-run divider comment:
*
*   <!-- ------- -->
*
* which lights up white-on-red in the middle of ordinary markup. HTML5 permits
* `--` inside comment text -- only `<!--`, `-->`, and `--!>` are reserved --
* so the strictness is SGML-era pedantry against input that is now legal.
* Found by the JavaScript-tag pl-ii sweep (post 1740, fixture 1740-1.cfm).
*
* Unlike bad-ampersand, this DIVERGES from GitHub rather than restoring it:
* GitHub's text.html.basic carries the same catch-all (with a lookahead that
* spares only the closing run), so GitHub renders these dividers as errors
* too. Do not "fix" this patch to match GitHub -- the divergence is the point,
* and it is the same trade adopting cfmleditor made: correct beats parity.
*
* The patch deletes ONLY the catch-all. The tag include stays, so CFML inside
* an HTML comment keeps highlighting; an inner `--` is simply unclaimed and
* falls through to the enclosing comment scope, rendering as comment text.
*/
function patchCommentHyphens(grammar, file) {
	// Both HTML-content contexts carry their own copy of the comment rule: the
	// general one, and the twin used inside <cfoutput> blocks.
	var ENTRIES = [
		"text-html-cfml",
		"text-html-cfml-cfoutput"
	];

	var CATCH_ALL = "invalid.illegal.bad-comments-or-CDATA.html";

	for (var entry of ENTRIES) {
		// Unguarded for the same reason as the patches above: a rename throws a
		// TypeError that names the expression.
		var patterns = grammar.repository[entry].patterns;

		var comments = patterns.filter((p) => p.name === "comment.block.html" && p.begin === "<!--");

		if (comments.length !== 1) {
			throw new Error(`${file}: ${entry} no longer carries exactly one comment.block.html rule; re-derive patchCommentHyphens`);
		}

		var index = comments[0].patterns.findIndex((p) => p.name === CATCH_ALL && p.match === "--");

		// Anchor check. If upstream drops the catch-all themselves, remove this
		// patch rather than leaving it to fail silently against nothing.
		if (index < 0) {
			throw new Error(`${file}: the ${entry} comment rule no longer carries the ${CATCH_ALL} catch-all; remove patchCommentHyphens`);
		}

		comments[0].patterns.splice(index, 1);
	}

	// The two entries above must be the ONLY carriers of the bare-`--` form. The
	// SGML rule (`<!` ... `>`) legitimately keeps the same scope NAME on a
	// different match, so full absence cannot be asserted the way bad-ampersand
	// asserts it; the exact rule shape is counted instead. A third comment
	// context appearing in an upstream update would survive this patch and put
	// pl-ii dividers back somewhere nobody re-tested -- fail loudly instead.
	function count(node) {
		if (Array.isArray(node)) {
			return node.reduce((sum, item) => sum + count(item), 0);
		}
		if (node && typeof node === "object") {
			var self = (node.name === CATCH_ALL && node.match === "--") ? 1 : 0;
			return Object.values(node).reduce((sum, value) => sum + count(value), self);
		}
		return 0;
	}

	if (count(grammar.repository) > 0) {
		throw new Error(`${file}: a bare-\`--\` ${CATCH_ALL} rule now appears outside the two HTML-content entries; extend patchCommentHyphens to cover it`);
	}

	return "comment-hyphens";
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
* The `<>` twin was confirmed by repro, not a fixture: SQL's not-equals hits it
* the same way. Measured before patching: real tags and cfscript comparisons
* take other rules and are unaffected.
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
function patchBadAngleBracket(grammar, file) {
	// Both HTML-content contexts carry their own copy of the pair: the general
	// one, and the twin used inside <cfoutput> blocks.
	var ENTRIES = [
		"text-html-cfml",
		"text-html-cfml-cfoutput"
	];

	var CATCH_ALLS = new Map([
		["invalid.illegal.incomplete.html", "<>"],
		["invalid.illegal.bad-angle-bracket.html", "<"]
	]);

	for (var entry of ENTRIES) {
		// Unguarded for the same reason as the patches above: a rename throws a
		// TypeError that names the expression.
		var patterns = grammar.repository[entry].patterns;

		for (var [name, match] of CATCH_ALLS) {
			var index = patterns.findIndex((p) => p.name === name && p.match === match);

			// Anchor check. If upstream drops a catch-all themselves, shrink this
			// patch rather than leaving it to fail silently against nothing.
			if (index < 0) {
				throw new Error(`${file}: ${entry} no longer carries the ${name} catch-all; shrink patchBadAngleBracket`);
			}

			patterns.splice(index, 1);
		}
	}

	// The two entries above must be the ONLY carriers. A third copy appearing
	// elsewhere in an upstream update would survive this patch and put pl-ii
	// operators back in some context nobody re-tested -- fail loudly instead.
	for (var scope of CATCH_ALLS.keys()) {
		if (JSON.stringify(grammar.repository).includes(scope)) {
			throw new Error(`${file}: ${scope} now appears outside the two HTML-content entries; extend patchBadAngleBracket to cover it`);
		}
	}

	return "bad-angle-bracket";
}

/**
* `<!DOCTYPE` renders with no scope on the keyword.
*
* The SGML rule's doctype sub-rule assigns entity.name.tag.doctype.html to
* CAPTURE GROUP 1 of a begin regex that has no capture group -- `(?i:...)` is
* non-capturing -- so the scope lands on nothing and the keyword falls through
* as plain text. The DTD strings beside it have a working rule, which is what
* makes the gap read as deliberate: the strings light up and the keyword does
* not.
*
* The patch wraps the begin in the parentheses upstream forgot, which is the
* whole fix: group 1 now exists and upstream's own captures entry applies.
* This is not a new claim, it is the rule's stated intent completed.
*
* GitHub renders the keyword plain too -- its text.html.basic carries the
* SAME dead rule, patched by the twin of this function in stock.js -- so the
* output diverges from GitHub the way comment-hyphens does: correct beats
* parity.
*/
function patchDoctypeCapture(grammar, file) {
	// Both HTML-content contexts carry their own copy of the SGML rule: the
	// general one, and the twin used inside <cfoutput> blocks.
	var ENTRIES = [
		"text-html-cfml",
		"text-html-cfml-cfoutput"
	];

	var BROKEN = "(?i:DOCTYPE)";

	for (var entry of ENTRIES) {
		// Unguarded for the same reason as the patches above: a rename throws a
		// TypeError that names the expression.
		var patterns = grammar.repository[entry].patterns;

		var sgml = patterns.filter((p) => p.name === "meta.tag.sgml.html" && p.begin === "<!");

		if (sgml.length !== 1) {
			throw new Error(`${file}: ${entry} no longer carries exactly one meta.tag.sgml.html rule; re-derive patchDoctypeCapture`);
		}

		var doctypes = sgml[0].patterns.filter((p) => p.name === "meta.tag.sgml.doctype.html");

		// Anchor check on the exact broken shape. If upstream fixes the capture
		// themselves, remove this patch rather than double-wrapping their regex.
		if (
			doctypes.length !== 1
			|| doctypes[0].begin !== BROKEN
			|| JSON.stringify(doctypes[0].captures) !== JSON.stringify({1: {name: "entity.name.tag.doctype.html"}})
		) {
			throw new Error(`${file}: the ${entry} doctype rule no longer has the broken no-capture shape; remove or re-derive patchDoctypeCapture`);
		}

		doctypes[0].begin = `(${BROKEN})`;
	}

	// The two entries above must be the ONLY carriers of the broken shape. A
	// third copy appearing in an upstream update would survive this patch and
	// keep a plain doctype in some context nobody re-tested -- fail loudly
	// instead.
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

	if (count(grammar.repository) > 0) {
		throw new Error(`${file}: a no-capture doctype rule now appears outside the two HTML-content entries; extend patchDoctypeCapture to cover it`);
	}

	return "doctype-capture";
}

/**
* Chained method calls in a script island render in different colors.
*
* The vendored grammars carry their own copy of Microsoft's JavaScript rules
* for <script> bodies, name lists included: a method name after a dot is
* checked against hardcoded rosters of DOM and standard-library names, so a
* jQuery chain alternates colors by accident of naming -- `.attr(` is a plain
* function while `.click(` collides with DOM click() and renders as a
* built-in, even though both resolve on the same object. The twin of
* patchMethodNameLists in stock.js, which carries the full rationale; deleting
* the rule here drops every dot-method name to the generic function-call rule
* -> entity.name.function. This DIVERGES from GitHub, which keeps the
* alternating colors.
*
* Unlike the stock source.js patched in stock.js, the vendored copy's
* dot-PROPERTY rosters already carry Microsoft's not-followed-by-a-paren
* guard, so a called name they list (`.text(`) cannot be stolen and no
* property rule needs touching.
*/
function patchMethodNameLists(grammar, file) {
	// Both script-island contexts carry their own copy of the rule: the general
	// one, and the twin used inside <cfoutput> blocks.
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
		// Unguarded for the same reason as the patches above: a rename throws a
		// TypeError that names the expression.
		var patterns = grammar.repository[entry].patterns;

		var matches = patterns.filter((p) => p.captures && Object.values(p.captures).some((c) => c.name === "support.function.dom.js"));

		// Anchor check on the exact roster shape. Anything else means the rule
		// was reworked -- re-derive rather than deleting a stranger.
		if (
			matches.length !== 1
			|| JSON.stringify(Object.values(matches[0].captures).map((c) => c.name)) !== JSON.stringify(EXPECTED)
			|| !matches[0].match.startsWith("(?x) (\\.)")
		) {
			throw new Error(`${file}: ${entry} no longer has the expected dot-method rule shape; re-derive patchMethodNameLists`);
		}

		patterns.splice(patterns.indexOf(matches[0]), 1);
	}

	// The deleted scopes must be gone entirely, except support.function.js,
	// which legitimately survives ONCE per entry in the bare-global call list
	// (parseInt, setTimeout -- not dot methods). A third carrier appearing in
	// an upstream update would survive this patch and put the alternating
	// colors back in some context nobody re-tested -- fail loudly instead.
	function count(node, scope) {
		if (Array.isArray(node)) {
			return node.reduce((sum, item) => sum + count(item, scope), 0);
		}
		if (node && typeof node === "object") {
			var self = (node.name === scope) ? 1 : 0;
			return Object.values(node).reduce((sum, value) => sum + count(value, scope), self);
		}
		return 0;
	}

	if (
		count(grammar, "support.function.event-handler.js") !== 0
		|| count(grammar, "support.function.dom.js") !== 0
		|| count(grammar, "support.function.js") !== ENTRIES.length
	) {
		throw new Error(`${file}: a dot-method name list now appears outside the two support-objects entries; extend patchMethodNameLists to cover it`);
	}

	return "method-name-lists";
}

/**
* `console` in a script island renders as a class, and its methods as
* built-ins.
*
* The twin of patchConsoleGlobal in stock.js, which carries the full
* rationale: the vendored copy of Microsoft's JavaScript rules gives `console`
* a rule of its own with a method roster, while `document` and `window` are
* one entry in a list scoped support.variable.dom and take whatever the
* method-call rule gives the name after them. Cutting the console match after
* the receiver group and rescoping it makes `console.log(` render exactly like
* `document.addEventListener(`. This DIVERGES from GitHub, which keeps the
* special rule.
*/
function patchConsoleGlobal(grammar, file) {
	// Both script-island contexts carry their own copy of the rule: the general
	// one, and the twin used inside <cfoutput> blocks.
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
		// Unguarded for the same reason as the patches above: a rename throws a
		// TypeError that names the expression.
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
			throw new Error(`${file}: ${entry} no longer has the expected console rule shape; re-derive patchConsoleGlobal`);
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
	function count(node, scope) {
		if (Array.isArray(node)) {
			return node.reduce((sum, item) => sum + count(item, scope), 0);
		}
		if (node && typeof node === "object") {
			var self = (node.name === scope) ? 1 : 0;
			return Object.values(node).reduce((sum, value) => sum + count(value, scope), self);
		}
		return 0;
	}

	if (
		count(grammar, "support.class.console.js") !== 0
		|| count(grammar, "support.function.console.js") !== 0
	) {
		throw new Error(`${file}: a console rule now appears outside the two support-objects entries; extend patchConsoleGlobal to cover it`);
	}

	return "console-global";
}

/**
* Object-literal keys in a script island render as plain text.
*
* The twin of patchObjectKeys in stock.js, which carries the full rationale:
* GitHub's own JS/TS rendering moved to a tree-sitter pipeline that colors
* keys (pl-c1), while the TextMate lineage assigns them only a meta scope the
* theme maps to nothing. The vendored copy of Microsoft's JavaScript rules has
* the same bare-identifier key rule as stock source.ts -- one per script-island
* context -- so the identifier gains the same constant.other.object.key
* capture. No added heuristic rule is needed here, unlike the stock source.js
* patched in stock.js: the Microsoft lineage matches keys inside real
* object-literal regions.
*/
function patchObjectKeys(grammar, file) {
	// Both script-island contexts carry their own copy of the rule: the general
	// one, and the twin used inside <cfoutput> blocks.
	var ENTRIES = [
		"source-js-object-member",
		"source-js-cfoutput-object-member"
	];

	// The bare-identifier key rule is the one whose ONLY capture assigns the
	// meta key scope to the whole match.
	function isCarrier(node) {
		return (
			node.captures
			&& Object.keys(node.captures).length === 1
			&& node.captures[0]
			&& node.captures[0].name === "meta.object-literal.key.js"
		);
	}

	for (var entry of ENTRIES) {
		// Unguarded for the same reason as the patches above: a rename throws a
		// TypeError that names the expression.
		var matches = grammar.repository[entry].patterns.filter(isCarrier);

		// Anchor check: exactly one such rule per entry, with the identifier
		// still spelled the way the rewrap below expects.
		if (
			matches.length !== 1
			|| !matches[0].match.startsWith("(?:[_$[:alpha:]][_$[:alnum:]]*)")
		) {
			throw new Error(`${file}: ${entry} no longer has the expected object-key rule shape; re-derive patchObjectKeys`);
		}

		// Promote the identifier's non-capturing group to group 1 and scope it.
		// The whole-match meta scope stays, mirroring upstream's own numeric-key
		// and function-key siblings.
		matches[0].match = `(${matches[0].match.slice("(?:".length)}`;
		matches[0].captures[1] = {name: "constant.other.object.key.js"};
	}

	// The two entries must be the ONLY carriers of the bare-key shape. A third
	// appearing in an upstream update would survive this patch and keep plain
	// keys in some context nobody re-tested -- fail loudly instead.
	function count(node) {
		if (Array.isArray(node)) {
			return node.reduce((sum, item) => sum + count(item), 0);
		}
		if (node && typeof node === "object") {
			var self = isCarrier(node) ? 1 : 0;
			return Object.values(node).reduce((sum, value) => sum + count(value), self);
		}
		return 0;
	}

	if (count(grammar) !== 0) {
		throw new Error(`${file}: a bare object-key rule now appears outside the two object-member entries; extend patchObjectKeys to cover it`);
	}

	return "object-keys";
}

/**
* Column names render as SQL keywords: `SELECT id, name, created` puts `name`
* in the same pl-k as SELECT.
*
* cfmleditor's inlined `source-sql` is Microsoft's vscode-mssql grammar, whose
* generic keyword rule is one ~830-word alternation copied from SQL Server
* Management Studio's coloring list. That list was assembled for SSMS parity,
* not correctness: `name`, `type`, `value`, `status`, `date`, `data` are all
* in it, none is a reserved word in any SQL dialect, and all six are among the
* most common column names there are. Upstream has only ever added to the
* list, and the SSMS behaviour it mirrors is a two-decade-old known quirk, so
* this is not going to be fixed by an update.
*
* Removing the six costs their T-SQL keyword uses -- `WITH (NAME = ...)`,
* `sp_rename ... 'COLUMN'`, `CREATE TYPE`. Those are admin and DDL statements
* that almost never appear in a cfquery body, whereas a SELECT list with one
* of these columns appears in nearly every one. A keyword-list grammar cannot
* tell the two apart, so the roster is a judgment about which usage dominates
* in this archive, not a claim about SQL.
*
* Do not add `key` to the roster, column name though it is. This list matches
* `PRIMARY` before the `primary key` storage-modifier rule further down the
* entry gets a look, so `KEY` in `PRIMARY KEY` is colored by this list alone
* and removing it leaves half the phrase plain in every CREATE TABLE.
*
* Top-level ```sql fences are unaffected: those route to starry-night's stock
* `source.sql` (the old TextMate bundle), whose keyword list has none of these
* words. Only cfquery bodies and queryExecute strings reach this rule.
*/
function patchSqlColumnWords(grammar, file) {
	var WORDS = ["name", "type", "value", "status", "date", "data"];

	var roster = sqlKeywordRoster(grammar, file, "patchSqlColumnWords");

	// Anchor check: every word to remove must be present exactly once, spelled
	// bare. A word already gone means upstream pruned it and this roster should
	// shrink; a word present twice or wrapped in regex means the list changed
	// shape and a plain string removal is no longer sound.
	for (var word of WORDS) {
		if (roster.words.filter((w) => w === word).length !== 1) {
			throw new Error(`${file}: source-sql keyword list no longer contains "${word}" exactly once; re-derive patchSqlColumnWords`);
		}
	}

	roster.write(roster.words.filter((w) => !WORDS.includes(w)));

	return "sql-column-words";
}

/**
* `COLLATE`, `ENGINE`, `DEFAULT` and `CHARSET` render as plain text inside a
* cfquery body.
*
* The same generic keyword list patchSqlColumnWords prunes was copied from
* SQL Server Management Studio, and these four are not in it: three are MySQL
* table options SSMS never sees, and DEFAULT is colored there by a different
* mechanism. In this archive a CREATE TABLE inside a cfquery is MySQL, and its
* last line renders with only the `=` signs colored. Found via fixtures
* 3918-4.sql and 4233-1.sql, whose `sql` fences get the same words from
* patchDdlKeywords in stock.js.
*
* All four are reserved in MySQL, and COLLATE and DEFAULT everywhere else, so
* none can be an unquoted column name: the collision that argues for pruning
* `name` argues for adding these. `CHARACTER SET` needs nothing here; both
* words are already in the list.
*/
function patchSqlDdlWords(grammar, file) {
	var WORDS = ["collate", "engine", "default", "charset"];

	var roster = sqlKeywordRoster(grammar, file, "patchSqlDdlWords");

	// A word already present means upstream added it; drop it from this list.
	for (var word of WORDS) {
		if (roster.words.includes(word)) {
			throw new Error(`${file}: source-sql keyword list already contains "${word}"; remove it from patchSqlDdlWords`);
		}
	}

	roster.write(roster.words.concat(WORDS));

	return "sql-ddl-words";
}

/**
* The generic keyword alternation of cfmleditor's inlined vscode-mssql grammar
* -- the one ~830-word `keyword.other.sql` rule in source-sql -- with its
* word list split out and a writer that puts a new list back. Shared by the
* two patches that edit the roster.
*
* The generic rule is the only `keyword.other.sql` rule whose match is a bare
* word alternation -- the DML/DDL siblings carry dotted suffixes
* (keyword.other.DML.sql) and are not what is being edited. It must also be
* the ONLY carrier of that alternation in the whole grammar: a second copy in
* an upstream update would keep the old roster in some context nobody
* re-tested -- fail loudly instead.
*/
function sqlKeywordRoster(grammar, file, patchName) {
	var HEAD = "\\b(?i)(";
	var TAIL = ")\\b";

	function isCarrier(node) {
		return (
			node.name === "keyword.other.sql"
			&& typeof node.match === "string"
			&& node.match.startsWith(HEAD)
			&& node.match.endsWith(TAIL)
		);
	}

	// Unguarded for the same reason as the patches above: a rename throws a
	// TypeError that names the expression.
	var matches = grammar.repository["source-sql"].patterns.filter(isCarrier);

	if (matches.length !== 1) {
		throw new Error(`${file}: source-sql no longer has exactly one generic keyword alternation; re-derive ${patchName}`);
	}

	function count(node) {
		if (Array.isArray(node)) {
			return node.reduce((sum, item) => sum + count(item), 0);
		}
		if (node && typeof node === "object") {
			var self = isCarrier(node) ? 1 : 0;
			return Object.values(node).reduce((sum, value) => sum + count(value), self);
		}
		return 0;
	}

	if (count(grammar) !== 1) {
		throw new Error(`${file}: a generic SQL keyword alternation now appears outside source-sql; extend ${patchName} to cover it`);
	}

	var rule = matches[0];

	return {
		words: rule.match.slice(HEAD.length, -TAIL.length).split("|"),
		write(words) {
			rule.match = HEAD + words.join("|") + TAIL;
		}
	};
}
