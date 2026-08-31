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
	["text.html.basic", [patchCommentHyphens]]
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
