/**
* LOCAL PATCHES -- applied to the parsed grammar at load time, never written
* to a file.
*
* The vendored JSON stays byte-identical to upstream. That is the whole point:
* a 606 KB, 15,510-line generated-looking file cannot be meaningfully diffed or
* merged, so hand-editing it would make every future update a conflict against
* something unreadable. The stock starry-night grammars are patched the same
* way, on clones, for the reason stock.js gives. Instead each patch is a named
* descriptor with a stated anchor, and updating upstream is a re-download plus
* the test suite.
*
* Every patch ASSERTS its anchor before mutating, and every assertion covers a
* condition that would otherwise fail SILENTLY. A patch that stops applying is
* worse than no patch -- it looks fixed and is not.
*
* Patch TOKENS here, never STRUCTURE. A structural gap is evidence for adopting
* a better grammar, not for writing a cleverer regex: a claim like "the first
* argument of this call is SQL" is about the parse tree, and no pattern match
* placed near the call site can make it soundly.
*
* ONE MODULE PER LANGUAGE FAMILY
*
* A patch lives in the module for the language whose RULES it edits, not the
* fence a reader types. cfmleditor inlines copies of the HTML rules,
* Microsoft's JavaScript rules and the vscode-mssql SQL grammar, so a fix to
* one of those families usually has a carrier in a stock grammar AND in both
* vendored grammars; it is one patch with one rationale and a branch per
* carrier, in html.js, javascript.js or sql.js. To place a new patch, find the
* rule in the grammar JSON and read its scope suffix.
*
* PATCH SHAPE
*
*   var patchObjectKeys = {
*       name: "object-keys",
*       branches: new Map([
*           ["source.ts", objectKeysInTs],
*           [CFML_TAG, objectKeysInCfml],
*           [CFML_SCRIPT, objectKeysInCfml]
*       ])
*   };
*
* The branch keys ARE the registry: this module derives which patches run on
* which grammar from them, so a branch cannot be written and left unregistered,
* and a grammar cannot be listed for a patch that has no branch for it. Branch
* functions take the grammar, return nothing, and throw with a message that
* starts with the scope name and ends by naming the branch function -- the
* greppable name of the code to re-derive.
*
* Repository lookups (`grammar.repository[NAME].patterns`) are deliberately
* unguarded everywhere. If upstream renames an entry the lookup throws a
* TypeError naming the exact expression, file and line -- strictly more
* precise than a hand-written message, and it cannot drift out of sync with
* the code the way one can.
*/

import {PATCHES as cfml} from "./cfml.js";
import {PATCHES as html} from "./html.js";
import {PATCHES as javascript} from "./javascript.js";
import {PATCHES as sql} from "./sql.js";
import {PATCHES as css} from "./css.js";
import {PATCHES as less} from "./less.js";

// Run order for any one grammar is this family order, then each module's own
// PATCHES order. No patch reads anything an earlier patch writes; the golden
// corpus is the backstop for that claim.
var FAMILIES = [cfml, html, javascript, sql, css, less];

// scope name -> [descriptor], derived from the branch keys.
var BY_SCOPE = new Map();

for (var family of FAMILIES) {
	for (var descriptor of family) {
		for (var scope of descriptor.branches.keys()) {
			if (!BY_SCOPE.has(scope)) {
				BY_SCOPE.set(scope, []);
			}

			BY_SCOPE.get(scope).push(descriptor);
		}
	}
}

/** Every scope name some patch has a branch for. */
export var SCOPES = new Set(BY_SCOPE.keys());

/**
* scope name -> [patch names], in the order they ran. Exported so the test
* suite can assert that every patch actually ran, rather than trusting that it
* did.
*/
export var applied = new Map();

/**
* Runs every branch registered for `grammar.scopeName` against `grammar`, in
* place. Throws if no patch names the scope: the caller asked to patch a
* grammar nobody has a patch for.
*
* Callable more than once per scope, on a fresh grammar object each time --
* test/contract.test.js boots both adapters in one process, so init() runs
* twice. Do not add a "patched already" guard here; the anchors catch a
* second pass over the SAME object, which is the only double-patch that is a
* bug.
*/
export function patch(grammar) {
	var descriptors = BY_SCOPE.get(grammar.scopeName);

	if (!descriptors) {
		throw new Error(`${grammar.scopeName}: no patch has a branch for this grammar`);
	}

	applied.set(grammar.scopeName, descriptors.map((descriptor) => {
		descriptor.branches.get(grammar.scopeName)(grammar);

		return descriptor.name;
	}));
}
