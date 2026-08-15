/**
* The CFML grammars this service ships, plus the two token patches they need.
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

var PATCHES = [patchBareInclude, patchSafeNavigation];

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
