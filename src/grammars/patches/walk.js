/**
* The traversal the "must be the ONLY carrier" assertions are built on. The
* `JSON.stringify(...).includes` scans in badAmpersandInCfml and
* badAngleBracketInCfml are the deliberate exception: there the deleted scope
* must not appear as ANY string, inside a compound name or a regex included,
* which a walk over rule objects cannot promise.
*
* A TextMate grammar is nested arrays and plain objects. Both functions walk
* it depth-first from `node`: arrays are recursed, every plain object is
* tested against `predicate` and then recursed whether or not it matched, so
* a carrier nested inside another carrier is still seen. Nothing else is
* visited. Results come back in pre-order, the order the grammar file reads.
*
* Callers choose the root. Some assertions mean "nowhere in the grammar" and
* pass the grammar; some mean "nowhere in the repository" and pass
* `grammar.repository`. Do not widen a root to make two call sites look
* alike: the top-level `patterns` list is a different promise from the
* repository, and a patch that only edits one should only assert about that
* one.
*/

/** Every plain object under `node` for which `predicate` is true. */
export function find(node, predicate) {
	var found = [];

	visit(node);

	return found;

	function visit(node) {
		if (Array.isArray(node)) {
			node.forEach(visit);
		} else if (node && typeof node === "object") {
			if (predicate(node)) {
				found.push(node);
			}

			Object.values(node).forEach(visit);
		}
	}
}

/** How many plain objects under `node` satisfy `predicate`. */
export function count(node, predicate) {
	return find(node, predicate).length;
}

/**
* The commonest predicate: a rule or capture whose `name` is exactly `scope`.
* Exact, not split on spaces -- a compound name like "a b" is a different
* claim, and the callers pinning a scope's carrier count mean the bare one.
*/
export function named(scope) {
	return (node) => node.name === scope;
}
