/**
* The CFML grammars this service ships: vendored, hashed, loaded and patched.
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
* Both files are byte-identical to upstream and must STAY that way -- every
* local change is a patch in patches/, applied to the parsed JSON by load()
* below. That is enforced, not assumed: test/corpus.test.js hashes both files
* on every run and fails if either changed. The hashes are recorded in three
* places on purpose -- here, in the test (which must not import them from this
* file, or it would be checking the code's claim against itself), and in
* LICENSES/README.md.
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
* in core/resolve.js already makes for tag-based `.cfc` files, and the reason
* the project exists: GitHub's CFML is out of reach, self-hosted it is a file.
*
* NO EXTERNAL DEPENDENCIES
*
* Both declare ZERO external includes -- everything, SQL and JavaScript
* included, is inlined into each file's own repository. That is why they need
* no `dependencies` and cannot be broken by an unrelated grammar changing.
*
* It is also what makes the patches in patches/ reach EVERYWHERE. A grammar
* that reaches its script blocks through an `include` by scope name hands them
* to whatever grammar is REGISTERED under that name, not to our patched copy,
* so a patch would stop at the include. With everything inlined there is no
* include chain to lose, so a patch applied to the file applies to every
* context in it.
*/

import {readFile} from "node:fs/promises";

import {patch} from "./patches/index.js";

var DIR = new URL("./", import.meta.url);

/**
* Loaded one after the other, not in parallel, so the patch registry records
* them in a fixed order and the corpus test can pin it as one string.
*/
export async function loadCfmlGrammars() {
	var tag = await load("cfml.tmLanguage.json");
	var script = await load("cfml-cfs.tmLanguage.json");

	return [tag, script];
}

/**
* `names` and `extensions` are emptied deliberately.
*
* Leaving cfmleditor's own lists in place would make these grammars resolvable
* straight from a fence tag, racing Linguist's registrations for the same names
* with no stated winner. Every route into these scopes is instead an explicit
* entry in `flagOverrides` (src/core/resolve.js), so the mapping is readable in one
* place and a tag cannot start resolving here by accident.
*
* `dependencies` is emptied because there genuinely are none -- these grammars
* inline everything they use. `missingScopes()` at boot confirms it.
*/
async function load(file) {
	var raw = await readFile(new URL(file, DIR), "utf8");
	var grammar = JSON.parse(raw);

	patch(grammar);

	return {...grammar, names: [], extensions: [], dependencies: []};
}
