/**
* Stock starry-night grammars, cloned and patched before registration.
*
* Unlike the CFML grammars beside this file, nothing here is vendored: the
* grammar objects come straight out of `@wooorm/starry-night`, whose bytes are
* already pinned by package-lock.json. Vendoring a copy would duplicate that
* pin with a weaker one and let the copy drift from the one the rest of the
* stock set uses -- so the patches in patches/ are applied to clones at boot,
* with the same DISCIPLINE the vendored grammars get (named patches, asserted
* anchors, fail loudly at boot) and without the vendoring.
*
* The patched grammar replaces the stock one in the list handed to
* createStarryNight(), so every include of `text.html.basic` BY SCOPE NAME --
* from markdown, erb, anything -- resolves to the patched clone through the
* registry. The stock module object itself is never mutated.
*/

import {CFML_TAG, CFML_SCRIPT} from "./scopes.js";
import {SCOPES, patch} from "./patches/index.js";

/**
* Returns `grammars` with every stock scope the patch layer names replaced by
* a patched clone. Throws if one of those scopes is missing from the list: a
* patch that silently stops applying looks fixed and is not.
*/
export function patchStockGrammars(grammars) {
	// Every scope with a patch, less the two vendored grammars, which load
	// separately and are not in the stock list.
	var remaining = new Set(SCOPES);
	remaining.delete(CFML_TAG);
	remaining.delete(CFML_SCRIPT);

	var patched = grammars.map((grammar) => {
		if (!remaining.has(grammar.scopeName)) {
			return grammar;
		}

		remaining.delete(grammar.scopeName);

		var clone = structuredClone(grammar);

		patch(clone);

		return clone;
	});

	if (remaining.size > 0) {
		throw new Error(`stock grammar list no longer contains: ${[...remaining].join(", ")}`);
	}

	return patched;
}
