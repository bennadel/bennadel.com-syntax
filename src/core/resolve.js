import {CFML_TAG, CFML_SCRIPT} from "../grammars/scopes.js";

/**
* Fence-tag policy: which TextMate scope a fence tag resolves to, and when the
* source itself overrules the tag. Nothing here produces HTML; core/highlight.js
* calls resolveScope() once and does the rest.
*
* The starry-night instance is a parameter rather than module state because
* core/highlight.js owns it (init() there creates and registers it) and this
* module must not import highlight.js back.
*/


// Local overrides layered on top of Linguist's alias set. Linguist already
// resolves the common cases ('js', 'cfm', 'cfml', 'bash'); this is only for
// conventions of our own, or mappings we disagree with.
// A value of `null` forces the plain-text path, which is a real and necessary
// override rather than a way of spelling "absent" -- see `txt` below.
var flagOverrides = new Map([
	// All three below were confirmed against a fence-tag scan of the archive on
	// 2026-08-04: each is a tag actually in use that resolved to nothing, so the
	// blocks were rendering as unhighlighted plain text.
	//
	// These point at a grammar, which means they only work while that grammar is
	// registered. Curation must keep all three targets checked -- and note that
	// curation cannot replace these entries, because it can add grammars but
	// cannot invent an alias.

	// EVERY CFML TAG IS OVERRIDDEN, INCLUDING THE ONES LINGUIST ALREADY RESOLVES.
	//
	// The CFML grammars are cfmleditor's, registered under
	// their own scope names (`embedding.cfml`, `embedding.cfml.cfs`) so they ADD
	// scopes rather than replacing Linguist's. Linguist's own `text.html.cfm` and
	// `source.cfscript` are therefore still registered and still reachable -- a
	// tag left un-overridden would silently keep using the 2013 grammar.
	//
	// That is why `cfm`, `cfml`, `coldfusion` and `coldfusion-cfc` appear here
	// even though they resolve upstream without help. They are not repairs; they
	// are the redirect. Adding a CFML tag means adding it here too.

	// Tag-based. `cfm` and `cfml` resolve upstream; `cf` is our own convention
	// and Linguist has never listed it.
	["cf", CFML_TAG],
	["cfm", CFML_TAG],
	["cfml", CFML_TAG],
	["coldfusion", CFML_TAG],

	// Script-based. `cfc` and `coldfusion-cfc` resolve upstream, to the file
	// extension's grammar; the rest are ours.
	//
	// `cfs` was NOT found in the archive scan -- it is a tag to write going
	// forward, not a repair to existing content. Nothing breaks if it goes
	// unused. `cfscript` was: it is the most obvious thing a commenter would
	// type and was the one spelling that rendered as plain text, because
	// Linguist reaches the grammar through the .cfc file extension rather than
	// by name.
	["cfs", CFML_SCRIPT],
	["cfscript", CFML_SCRIPT],
	["cfc", CFML_SCRIPT],
	["coldfusion-cfc", CFML_SCRIPT],

	// Same syntax as .gitignore, which already resolves to this scope.
	["dockerignore", "source.gitignore"],

	// Newline-delimited JSON -- every line is a JSON document, and there is no
	// separate grammar for the container format.
	["ndjson", "source.json"],

	// `conf` resolves to `source.ini` upstream, which is wrong twice over: the
	// archive's `conf` blocks are web-server configs, and INI syntax treats `;`
	// as a comment, so every nginx statement terminator rendered as `pl-c`.
	//
	// nginx over apacheconf by inspection, not inference: all 4 blocks using the
	// tag were read, and 3 are nginx (`upstream`, `log_format`, `location`)
	// against 1 Apache (`RewriteRule`).
	//
	// That one Apache block is the known cost, and it is small -- under this
	// grammar it renders nearly plain rather than acquiring false tokens, which
	// is the opposite of the `txt` case below and the reason this is an override
	// rather than a `null`. Retag it `apache` if it ever matters; the tag
	// already resolves to `source.apacheconf` on its own.
	//
	// INI itself is unaffected: `ini` is a separate tag in the archive and still
	// resolves to `source.ini` on its own.
	["conf", "source.nginx"],

	// `txt` resolves to `text.adblock` with the full grammar set loaded, and
	// adblock filter syntax treats a leading `!` as a comment and `||`/`^` as
	// operators. A plain-text block tagged `txt` therefore comes back with lines
	// wrapped in `pl-c`, which Primer renders grey and italic -- prose styled as
	// a comment and effectively hidden.
	//
	// `text` and `plain` need nothing -- no grammar means plain text, which is
	// already correct. `txt` is the exception, so it needs saying explicitly.
	//
	// Curation would also have fixed this by never registering the adblock
	// grammar, but curation was declined: a whitelist is wrong once
	// readers can submit code in languages the site owner never uses. Overrides
	// are the chosen instrument, and this is one.
	["txt", null]
]);

/**
* Resolve a fence tag to a TextMate scope, corrected by the source. Undefined
* means "no grammar", which is a normal outcome, not an error.
*
* @param {object} starryNight   The registry init() built; only flagToScope is read.
* @param {string} flag          Fence tag, e.g. 'cfml'.
* @param {string} source        Normalized source, for refineScope().
*/
export function resolveScope(starryNight, flag, source) {
	return refineScope(lookupScope(starryNight, flag), source);
}

/**
* Look a fence tag up without consulting the source.
* Overrides win; otherwise Linguist decides.
*/
function lookupScope(starryNight, flag) {
	if (!flag) return undefined;
	var normalized = String(flag).trim().toLowerCase();
	if (!normalized) return undefined;

	// `has`, not `??`. A `null` override means "force plain text", and `??` would
	// treat it as absent and fall straight through to Linguist -- which is the
	// exact lookup the override exists to suppress.
	if (flagOverrides.has(normalized)) return flagOverrides.get(normalized) ?? undefined;

	return starryNight.flagToScope(normalized);
}

/**
* Adjust a resolved scope using the source itself.
*
* Only one rule, and it exists because a `.cfc` can be written either way:
* tag-based in older code, script-based in newer. Linguist maps the extension to
* `source.cfscript`, which renders script correctly and mangles tags -- angle
* brackets as `pl-k`, tag names as `pl-smi` instead of `pl-ent`.
*
* GitHub has the same behaviour, so this is a deliberate DIVERGENCE from parity
* rather than a bug fix. It is the exact case the project exists for: GitHub's
* CFML grammar is weak and permanently out of reach, and self-hosted it is just
* a file.
*
* This is TextMate's `firstLineMatch` idea -- pick the grammar by looking at the
* content -- implemented here instead of in a grammar, because starry-night
* resolves a flag to a scope without ever consulting the source, and we have the
* source in hand anyway. A custom grammar could not do it more cleanly: a
* grammar has one scopeName, so content-dependent dispatch would need a
* synthetic wrapper grammar for the same result.
*
* Applied to the scope, not the tag, so `cfc`, `cfs` and `cfscript` all benefit.
* Content wins over the tag's claim: source with tags at line starts is not
* script, whatever it was labelled.
*/
function refineScope(scope, source) {
	if (scope === CFML_SCRIPT && looksTagBased(source)) return CFML_TAG;

	return scope;
}

/**
* Does this look like tag-based CFML rather than script?
*
* Anchored to the start of a line, which is what makes it safe. A bare
* /<cf[a-z]/ would fire on `var s = "<cfoutput>"` inside a script-based
* component, and a false positive is the expensive direction: `text.html.cfm`
* produces ZERO tokens for script-based source, so a wrong guess turns a
* correctly highlighted block into a plain one.
*
* Matching any `<cf...` tag rather than `<cfcomponent` specifically is
* deliberate. Twenty years of blog examples are mostly fragments -- a lone
* `<cffunction>` or `<cfset>` with no component wrapper -- and those are exactly
* as tag-based as a full file.
*/
function looksTagBased(source) {
	// Lucee tag islands -- tag syntax legally embedded IN script between ```
	// fences -- must not count as evidence of a tag-based file: an island's
	// `<cfquery>` sits at the start of a line exactly like real tag code, and
	// routing the surrounding component to the tag grammar is the false
	// positive this function exists to avoid. Only PAIRED fences are stripped:
	// on a lone ``` (a truncated fragment), the conservative reading is to
	// leave the source alone rather than discard everything after it.
	var withoutIslands = source.replace(/```[\s\S]*?```/g, "");

	return /^[ \t]*<cf[a-z]/im.test(withoutIslands);
}

