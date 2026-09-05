/**
* Golden corpus.
*
* Highlighting output is not something you can eyeball into correctness. A
* grammar update, a starry-night bump, or a change to normalize() can silently
* reclassify tokens, and the result still LOOKS like syntax highlighting. The
* only practical check is: does this input still produce exactly the bytes it
* produced when a human last looked at it and agreed?
*
* So each fixture is a pair:
*
*   test/__fixtures__/<slug>.<language>.code    input, hand-written
*   test/__fixtures__/<slug>.<language>.html    expected `html` field, generated
*
* The language comes from the filename, so adding a case is one file plus a
* regenerate. Run with --update to rewrite the .html files, then READ THE DIFF
* before committing it. An unreviewed --update turns this from a test into a
* rubber stamp -- it will happily bless a regression.
*
*   ./scripts/test.sh            both suites
*   ./scripts/test-update.sh     regenerate goldens, then read the diff
*
* This targets src/core/highlight.js, the pure module -- NOT an adapter and not a
* packaging artifact. That is deliberate: adding the Lambda entry point must not
* fork verification. The request/response envelope is covered separately by
* test/contract.test.js, which is a different concern and deliberately coarse
* about highlighting output so that a grammar change cannot fail a transport
* test.
*
* WHY THIS LIVES IN test/ RATHER THAN NEXT TO THE CODE. The deployment zip is
* built by copying src/ wholesale, so anything under src/ ships. Do not move
* tests or fixtures under src/ and hold them back with exclusion rules in
* .dockerignore: an exclusion covers only the names it lists, so the next helper
* module or fixture directory ships silently. Living outside src/ means the
* allow-list denies this by default rather than by enumeration.
* docker-compose.yaml bind-mounts test/ into the test services; nothing else
* mounts it and no image stage copies it.
*/

import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import {readdir, readFile, writeFile} from "node:fs/promises";
import {promisify} from "node:util";

import {loadConfig} from "../src/core/config.js";
import {init, highlight, normalize, longestLine} from "../src/core/highlight.js";
import {applied as cfmlPatches} from "../src/grammars/cfml.js";
import {applied as stockPatches} from "../src/grammars/html.js";

var DIR = new URL("./__fixtures__/", import.meta.url);
var GRAMMARS = new URL("../src/grammars/", import.meta.url);
var SERVER_ADAPTER = new URL("../src/adapters/server.js", import.meta.url);
var UPDATE = process.argv.includes("--update");

var execFileAsync = promisify(execFile);

/**
* Vendored grammar files and their upstream SHA-256s, from cfmleditor commit
* 8af4a78ebc7096224d7d3ec080fe7672badca1d6. Provenance and the update procedure
* are in LICENSES/README.md; the same hashes appear in src/grammars/cfml.js.
*
* Deliberately duplicated rather than imported from the loader: a hash the code
* under test supplies about itself checks nothing. These have to be written down
* somewhere the loader cannot reach.
*/
var SOURCES = {
	"cfml.tmLanguage.json":
		"61e7d83cc25ab53816ea427175acb2e8e5ce96f78cb098a3fe2e5fbf3b88de42",
	"cfml-cfs.tmLanguage.json":
		"e3681da75d487b39d5f1ba0e05d28cbbabbc869189582f4828c6c645d9d6207e"
};

/**
* Fixture languages that are SUPPOSED to fall through to plain text, rather
* than a fixture whose grammar has gone missing. Keeping this explicit is what
* lets the runner assert resolution in both directions instead of only
* checking that highlighting happened.
*/
var EXPECT_PLAIN = new Set(["text"]);

// No token in this env object matters here -- loadConfig does not require one,
// which is itself asserted below.
var config = loadConfig(process.env);

await init(config);

var failures = 0;
var updated = 0;

// ---------------------------------------------------------------------------
// Golden fixtures
// ---------------------------------------------------------------------------

console.log("");
console.log("golden fixtures");

var files = await readdir(DIR);
var entries = files
	.filter((name) => name.endsWith(".code"))
	.sort();

if (entries.length === 0) {
	fail("fixtures present", "no *.code files found in test/__fixtures__/");
}

for (var entry of entries) {
	// <slug>.<language>.code -- the language is the second-to-last segment, so a
	// slug may contain dots without ambiguity.
	var parts = entry.split(".");
	var language = parts[parts.length - 2];
	var goldenName = entry.replace(/\.code$/, ".html");

	var code = await readFile(new URL(entry, DIR), "utf8");
	var result = highlight(code, language);

	// Fixtures assert in BOTH directions, because both failures are silent.
	//
	// A language fixture that stopped resolving would still "match" once its
	// golden was regenerated from the broken output. And a plain-text fixture
	// that STARTED resolving is the `txt` -> text.adblock bug: prose quietly
	// acquiring token spans. Neither is visible in a golden diff alone, because
	// --update would happily bless either one.
	var expectPlain = EXPECT_PLAIN.has(language);
	var isPlain = !result.highlighted && result.resolvedLanguage == null;

	if (expectPlain !== isPlain) {
		fail(`${entry} resolves as expected`,
			expectPlain
				? `expected the plain-text path, got resolvedLanguage=${result.resolvedLanguage} -- a grammar has claimed "${language}"`
				: `highlighted=${result.highlighted} resolvedLanguage=${result.resolvedLanguage} -- is "${language}" still a known flag?`);
		continue;
	}

	if (UPDATE) {
		await writeFile(new URL(goldenName, DIR), result.html, "utf8");
		updated++;
		console.log(`  wrote ${goldenName}`);
		continue;
	}

	try {
		var expected = await readFile(new URL(goldenName, DIR), "utf8");
	} catch {
		fail(entry, `no golden file -- run with --update to create ${goldenName}`);
		continue;
	}

	if (result.html === expected) {
		pass(`${entry} (${result.resolvedLanguage})`);
	} else {
		fail(entry, diffAt(result.html, expected));
	}
}

// ---------------------------------------------------------------------------
// Behaviour that golden files cannot express
// ---------------------------------------------------------------------------

if (!UPDATE) {
	console.log("");
	console.log("normalize()");

	assertEqual("CRLF becomes LF", normalize("a\r\nb"), "a\nb");
	assertEqual("lone CR becomes LF", normalize("a\rb"), "a\nb");
	assertEqual("one trailing newline dropped", normalize("a\n"), "a");
	assertEqual("only ONE trailing newline dropped", normalize("a\n\n"), "a\n");
	assertEqual("trailing CRLF dropped", normalize("a\r\n"), "a");
	assertEqual("interior blank lines kept", normalize("a\n\nb"), "a\n\nb");
	assertEqual("leading whitespace kept", normalize("\ta"), "\ta");
	assertEqual("trailing spaces kept", normalize("a  "), "a  ");

	console.log("");
	console.log("longestLine()");

	assertEqual("single line length", longestLine("abc").length, 3);
	assertEqual("single line number", longestLine("abc").number, 1);
	assertEqual("picks the longest", longestLine("a\nbbbb\ncc").length, 4);
	assertEqual("reports its line number", longestLine("a\nbbbb\ncc").number, 2);
	assertEqual("first wins on a tie", longestLine("aa\nbb").number, 1);
	assertEqual("empty string", longestLine("").length, 0);
	assertEqual("trailing newline", longestLine("abc\n").length, 3);

	console.log("");
	console.log("loadConfig()");

	// The garbled cases are the ones that matter: "2OO" parses to NaN, every
	// guard using these values is a `>` comparison, and `n > NaN` is always
	// false -- so an unvalidated typo silently turns the guard off.
	assertThrows("garbled MAX_BYTES refused", () => loadConfig({MAX_BYTES: "2OO"}), "MAX_BYTES");
	assertThrows("empty MAX_BYTES refused", () => loadConfig({MAX_BYTES: ""}), "MAX_BYTES");
	assertThrows("garbled MAX_LINE_LENGTH refused", () => loadConfig({MAX_LINE_LENGTH: "2OO"}), "MAX_LINE_LENGTH");
	assertThrows("negative MAX_LINE_LENGTH refused", () => loadConfig({MAX_LINE_LENGTH: "-1"}), "MAX_LINE_LENGTH");

	var defaults = loadConfig({});
	assertEqual("default MAX_BYTES", defaults.maxBytes, 262144);
	assertEqual("default MAX_LINE_LENGTH", defaults.maxLineLength, 2000);
	// Not throwing on an empty env IS the assertion: tools/ and this test run
	// the highlighting core without a credential, so an absent token must be a
	// boot()-level refusal, never a parse error.
	assertEqual("no token is not a config error", defaults.token, "");

	console.log("");
	console.log("boot() refusal kills the process");

	// The one case that has to be a child process, because the exit code IS the
	// behaviour: an adapter's boot() failure must kill the process non-zero,
	// which is the only signal Docker's restart loop and a failed Lambda INIT
	// ever see. The token is the variable used because its check lives in
	// boot() rather than loadConfig(), so no in-process test covers it.
	await assertBootRefuses("missing HIGHLIGHT_TOKEN", {HIGHLIGHT_TOKEN: ""});

	console.log("");
	console.log("highlight() guards");

	var unknown = highlight("x = 1", "not-a-real-language");
	assertEqual("unknown language is not an error", unknown.highlighted, false);
	assertEqual("unknown language resolves to null", unknown.resolvedLanguage, null);
	assertEqual("unknown language still returns text", unknown.html, "x = 1");

	var noFlag = highlight("x = 1");
	assertEqual("absent language is not an error", noFlag.highlighted, false);

	// The ReDoS guard. This is the behaviour MAX_LINE_LENGTH exists for, and it
	// must degrade to escaped plain text rather than throwing or truncating.
	var long = highlight("a".repeat(config.maxLineLength + 1), "cfml");
	assertEqual("over-long line refuses", long.highlighted, false);
	assertEqual("over-long line resolves to null", long.resolvedLanguage, null);
	assertEqual("over-long line returns all of it", long.html.length, config.maxLineLength + 1);

	var atLimit = highlight("a".repeat(config.maxLineLength), "cfml");
	assertEqual("exactly at the limit still highlights", atLimit.highlighted, true);

	// One over-long line poisons the whole block -- highlighting is all or
	// nothing, so callers never get a partially-highlighted result.
	var mixed = highlight(`<cfset a = 1>\n${"b".repeat(config.maxLineLength + 1)}`, "cfml");
	assertEqual("one long line refuses the whole block", mixed.highlighted, false);

	console.log("");
	console.log("escaping");

	// Pinned to GitHub's exact form rather than "something got escaped". Do not
	// loosen these to accept either the named or the hexadecimal reference, and
	// do not drop the `>` case: the archive holds twenty years of rows written by
	// the Gist pipeline, and hast-util-to-html's defaults (hex, and `>` left
	// bare) differ from it on nearly every line.
	var escaped = highlight("a < b && c > d", "not-a-real-language");
	assertEqual("plain text uses named references", escaped.html, "a &lt; b &amp;&amp; c &gt; d");

	// The highlighted path escapes by a different route -- raw nodes plus
	// allowDangerousHtml -- so it gets its own assertion instead of relying on
	// the corpus to notice. This is the exact byte sequence the old Gist payload
	// carried for a cfscript tag.
	var marked = highlight("<cfscript>", "cfml");
	assertEqual(
		"highlighted text escapes without damaging markup",
		marked.html,
		"&lt;<span class=\"pl-ent\">cfscript</span>&gt;"
	);
	assertEqual("no hexadecimal references remain", marked.html.includes("&#x"), false);

	var empty = highlight("", "cfml");
	assertEqual("empty input does not throw", typeof empty.html, "string");

	// -------------------------------------------------------------------------
	// Flag resolution
	//
	// The service registers `all` (694 grammars) because curation was closed
	// outright -- not deferred -- and Linguist's alias set is far
	// wider than the languages this archive
	// actually uses. That makes junk and plain-text fence tags a live hazard:
	// they do not fail, they resolve to something obscure and produce confident,
	// wrong highlighting. `txt` -> `text.adblock` styled prose as a comment.
	//
	// These assertions are the guard, and they are deliberately about
	// RESOLUTION rather than output bytes -- a golden file cannot express "this
	// tag must not find a grammar."
	// -------------------------------------------------------------------------

	console.log("");
	console.log("flag resolution");

	// Must fall through to plain text. Fence tags a human writes when they mean
	// "no highlighting", plus the junk that a twenty-year archive accumulates.
	var mustBePlain = [
		"text", "txt", "plain", "plaintext", "none", "code", "output", "log",
		"terminal", "pre", "raw", "data", "config", "error", "stacktrace",
		"example", "pseudocode", "markup", "template", "", "   ",
		"not-a-real-language"
	];

	for (var flag of mustBePlain) {
		var result = highlight("! plain <text> & symbols", flag);
		assertEqual(
			`"${flag}" falls through to plain text`,
			`${result.highlighted}/${result.resolvedLanguage}`,
			"false/null"
		);
	}

	// Must keep resolving. The inverse failure: a grammar quietly disappearing
	// on a starry-night bump or an over-eager curation pass, which would degrade
	// silently to plain text and be caught by nothing else here.
	//
	// This is not a sample -- it is every tag found in the 2026-08-04 fence-tag
	// scan of the archive that resolves to a grammar, plus `javascript` and
	// `bash` as the spelled-out forms. Curating the grammar set must not break
	// any of them, which is exactly what this list is for.
	var mustResolve = [
		// CFML resolves to cfmleditor's scopes, and it does so
		// ONLY because of a flagOverrides entry -- Linguist still registers
		// `text.html.cfm` and `source.cfscript`, and both are still reachable. A
		// dropped override would not fail; it would quietly go back to the 2013
		// grammar. That is what these three pin.
		["cfml", "embedding.cfml"],
		["cfm", "embedding.cfml"],
		["cfc", "embedding.cfml.cfs"],
		["js", "source.js"],
		["javascript", "source.js"],
		["jsx", "source.js"],
		["ts", "source.ts"],
		["tsx", "source.tsx"],
		["sql", "source.sql"],
		["java", "source.java"],
		["html", "text.html.basic"],
		["htm", "text.html.basic"],
		["php", "text.html.php"],
		["go", "source.go"],
		["bash", "source.shell"],
		["sh", "source.shell"],
		["json", "source.json"],
		["css", "source.css"],
		["less", "source.css.less"],
		["svelte", "source.svelte"],
		["vue", "source.vue"],
		["xml", "text.xml"],
		["yaml", "source.yaml"],
		["yml", "source.yaml"],
		["toml", "source.toml"],
		["ini", "source.ini"],
		// Not in the original scan. Added when the archive's one Apache block was
		// retagged off `conf`, which is overridden to nginx.
		["apache", "source.apacheconf"],
		// Also not in the original scan. Terminal transcripts were tagged `txt` to
		// stop bash's string rules from eating output containing an apostrophe;
		// `console` is the graceful form -- prompts parse as shell, output is
		// opaque. Listed here so the grammar cannot vanish now that it is relied
		// on. See prompts-and-output.console.code.
		["console", "text.shell-session"],
		["csv", "source.csv"],
		["diff", "source.diff"],
		["md", "text.md"],
		["dockerfile", "source.dockerfile"],
		["gitignore", "source.gitignore"]
	];

	for (var [flag, scope] of mustResolve) {
		assertEqual(`"${flag}" resolves to ${scope}`, highlight("x", flag).resolvedLanguage, scope);
	}

	// Tags that resolve ONLY because of a flagOverrides entry. Kept separate
	// from the list above because the failure mode differs: these break if the
	// override is dropped OR if curation stops registering the target grammar,
	// and either way the symptom is a silent downgrade to plain text rather than
	// an error. All three are tags found in the archive scan.
	var mustResolveViaOverride = [
		["cf", "embedding.cfml"],
		["cfs", "embedding.cfml.cfs"],
		["cfscript", "embedding.cfml.cfs"],
		// Linguist's own spellings, redirected. They resolved perfectly well on
		// their own -- to the 2013 grammar -- so unlike the rest of this list the
		// failure mode is not plain text but silently worse highlighting.
		["coldfusion", "embedding.cfml"],
		["coldfusion-cfc", "embedding.cfml.cfs"],
		["dockerignore", "source.gitignore"],
		["ndjson", "source.json"],
		// Overridden away from source.ini. That `ini` itself is untouched is
		// already asserted in the list above, which is the pair that matters --
		// an override must redirect one tag without disturbing its neighbours.
		["conf", "source.nginx"]
	];

	for (var [flag, scope] of mustResolveViaOverride) {
		assertEqual(`override: "${flag}" -> ${scope}`, highlight("x", flag).resolvedLanguage, scope);
	}

	// -------------------------------------------------------------------------
	// Grammar registry: dependencies missingScopes() cannot see
	//
	// source.js reaches source.js.regexp through a raw include WITHOUT
	// declaring it as a dependency, so boot()'s missingScopes() check is blind
	// to it -- and vscode-textmate disables the ENTIRE rule whose include
	// cannot resolve. Unregistered, no JS regex literal is recognized at all:
	// /[0-9A-F]/ parses as division and array math, and `9A` renders as an
	// illegal identifier (pl-ii, white on red). init() registers the grammar
	// manually; these pin that registration.
	// -------------------------------------------------------------------------

	console.log("");
	console.log("grammar registry");

	var regex = highlight("var r = /[0-9A-F]/g;", "js");
	assertEqual("JS regex literal is a regex",
		regex.html.includes("<span class=\"pl-sr\">"), true);
	assertEqual("JS regex literal carries no illegal tokens",
		regex.html.includes("pl-ii"), false);

	// The inverse direction: the regex rule must not over-claim division. Its
	// lookbehind requires an operator-ish character, and an identifier before
	// the slash is not one.
	assertEqual("division is not a regex",
		highlight("var x = a / b / c;", "js").html.includes("pl-sr"), false);

	// The same literal inside a script block of an HTML fence --
	// text.html.basic reaches source.js through the registry, so the
	// registration must hold there too.
	var scriptBlock = highlight("<script>\nvar r = /[0-9A-F]/g;\n</script>", "htm");
	assertEqual("regex in an HTML script block is a regex",
		scriptBlock.html.includes("<span class=\"pl-sr\">"), true);
	assertEqual("regex in an HTML script block carries no illegal tokens",
		scriptBlock.html.includes("pl-ii"), false);

	// Case and whitespace are normalized before lookup, so these are the same
	// tag. Worth pinning because the archive's fence tags were hand-typed.
	assertEqual("flags are case-insensitive", highlight("x", "CFML").resolvedLanguage, "embedding.cfml");
	assertEqual("flags are trimmed", highlight("x", "  js  ").resolvedLanguage, "source.js");

	// -------------------------------------------------------------------------
	// Content-based scope refinement
	//
	// A .cfc may be tag-based or script-based, and Linguist maps the extension to
	// `source.cfscript` either way. refineScope() looks at the source to correct
	// that. Both directions matter and both fail silently: script-based content
	// under text.html.cfm produces NO tokens at all, and tag-based content under
	// source.cfscript scopes tag names as `pl-smi` instead of `pl-ent`.
	// -------------------------------------------------------------------------

	console.log("");
	console.log("cfc tag-vs-script detection");

	var asCfc = (code) => highlight(code, "cfc").resolvedLanguage;

	assertEqual("full tag-based component -> embedding.cfml",
		asCfc("<cfcomponent>\n\t<cffunction name=\"init\">\n\t</cffunction>\n</cfcomponent>"), "embedding.cfml");
	// Twenty years of blog examples are mostly fragments with no wrapper.
	assertEqual("bare <cffunction> fragment -> embedding.cfml",
		asCfc("<cffunction name=\"getData\">\n\t<cfargument name=\"id\" />\n</cffunction>"), "embedding.cfml");
	assertEqual("leading CFML comment -> embedding.cfml",
		asCfc("<!--- notes --->\n<cfcomponent>\n</cfcomponent>"), "embedding.cfml");
	assertEqual("indented tag -> embedding.cfml",
		asCfc("\t<cfset x = 1 />"), "embedding.cfml");

	assertEqual("script component stays embedding.cfml.cfs",
		asCfc("component accessors=\"true\" {\n\tfunction init() { return this; }\n}"), "embedding.cfml.cfs");
	assertEqual("javadoc-first script stays embedding.cfml.cfs",
		asCfc("/**\n* Does a thing.\n*/\ncomponent {\n}"), "embedding.cfml.cfs");

	// The false-positive traps. These are why the pattern is line-anchored: a
	// bare /<cf[a-z]/ would fire on both, and misrouting script-based source to
	// text.html.cfm yields zero tokens -- strictly worse than doing nothing.
	assertEqual("CFML tag inside a string stays embedding.cfml.cfs",
		asCfc("component {\n\tfunction f() {\n\t\tvar s = \"<cfoutput>#x#</cfoutput>\";\n\t}\n}"), "embedding.cfml.cfs");
	assertEqual("CFML tag in a trailing comment stays embedding.cfml.cfs",
		asCfc("component {\n\t// replaces <cfoutput> usage\n\tfunction f() {}\n}"), "embedding.cfml.cfs");

	// A Lucee tag island is the third false-positive trap: real tag syntax,
	// legally inside script, sitting at the start of a line exactly like the
	// tag-based code the pattern hunts for. Routing on it would send the
	// component to the tag grammar and past the cfs-side island handling.
	assertEqual("tag island inside script stays embedding.cfml.cfs",
		asCfc("component {\n\tfunction f() {\n\t\t```\n\t\t<cfset x = 1 />\n\t\t```\n\t}\n}"), "embedding.cfml.cfs");

	// The refinement keys off the scope, not the tag, so the explicit script
	// spellings get the same correction.
	assertEqual("\"cfs\" with tag-based content -> embedding.cfml",
		highlight("<cfset x = 1 />", "cfs").resolvedLanguage, "embedding.cfml");
	assertEqual("\"cfscript\" with tag-based content -> embedding.cfml",
		highlight("<cfset x = 1 />", "cfscript").resolvedLanguage, "embedding.cfml");

	// Unrelated scopes must be untouched by the refinement.
	assertEqual("cfml with tag content unaffected",
		highlight("<cfset x = 1 />", "cfml").resolvedLanguage, "embedding.cfml");
	assertEqual("js containing a cf-looking line unaffected",
		highlight("const s = 1;\n<cfset x = 1 />", "js").resolvedLanguage, "source.js");

	// -------------------------------------------------------------------------
	// CFML grammar: what cfmleditor fixed, and what we still patch
	//
	// cfmleditor's grammars replace Linguist's 2013 cfscript grammar, and this
	// section is the ledger for that swap. The first group is behaviour the
	// new grammar gives us for free and the old one got wrong -- asserted so a
	// future downgrade or a bad upstream bump is caught rather than admired. The
	// second is the two token patches in src/grammars/cfml.js, which are the only
	// things we still carry ourselves.
	//
	// Every assertion names the specific misclassification, so if upstream ever
	// fixes one the corresponding rule can be deleted and this tells you which.
	// -------------------------------------------------------------------------

	console.log("");
	console.log("CFML grammar");

	var script = (code) => highlight(code, "cfs").html;

	// -- what cfmleditor fixed --------------------------------------------------

	// CF2021 keyword. Asserted because a downgrade would scope it as
	// variable.other -> pl-smi, which looks like ordinary code rather than a bug.
	assertEqual("final is a keyword, not a variable",
		script("final var LIMIT = 10;").includes("<span class=\"pl-k\">final</span>"), true);

	// CFML is case-insensitive and so is the grammar. Asserted separately because
	// a rule that matches only lowercase still passes the check above while
	// silently doing nothing on `Final` -- the failure is invisible either way.
	assertEqual("final is matched case-insensitively",
		script("Final var LIMIT = 10;").includes("<span class=\"pl-k\">Final</span>"), true);

	// Do not try to reproduce this with a regex near the call site if it ever
	// breaks: "the first argument of this call is SQL" is a claim about the parse
	// tree, and a pattern match cannot make it. cfmleditor models the call
	// structure, which is why the SQL is genuinely embedded.
	assertEqual("queryExecute embeds SQL",
		script("var r = queryExecute( \"SELECT id FROM t\" );").includes("<span class=\"pl-k\">SELECT</span>"), true);
	assertEqual("queryExecute SQL survives mixed case",
		script("var r = QueryExecute( \"SELECT id FROM t\" );").includes("<span class=\"pl-k\">SELECT</span>"), true);

	// -- the patches we still carry ---------------------------------------------

	// CF2018. cfmleditor has no rule for `?.`, so without our patch neither
	// character is claimed and the operator renders as plain text.
	assertEqual("safe navigation stays one operator",
		script("var a = b?.c;").includes("<span class=\"pl-k\">?.</span>"), true);

	// cfmleditor lists `include` among the tag-in-script names but its lookahead
	// requires an identifier or brace after it, so the bare quoted form falls
	// through to variable.other -> pl-smi, which is GitHub's default text colour
	// and reads as broken. GitHub's own rendering of this form is pl-ent.
	assertEqual("bare include is a tag name",
		script("include \"/core/cfmlx.cfm\";").includes("<span class=\"pl-ent\">include</span>"), true);
	assertEqual("include as an identifier prefix is untouched",
		script("includeThis = 1;").includes("<span class=\"pl-ent\">include</span>"), false);

	// The patch layer must not disturb what the grammar already gets right.
	assertEqual("ordinary strings are still strings",
		script("var s = \"hello\";").includes("<span class=\"pl-s\">"), true);

	// -- patches now reach nested script ----------------------------------------

	// Do not reintroduce a wrapper grammar to carry the patches. A wrapper only
	// applies where WE pick the entry grammar, so inside a tag-based file it is
	// bypassed entirely -- TextMate resolves an included scope name to the stock
	// grammar, and no patch of ours reaches it.
	//
	// cfmleditor inlines everything instead of including by name, so there is no
	// include chain to lose and a patch applied to the file applies in every
	// context in it. Asserted in both grammars because they are separate files and
	// the patch has to be applied to each.
	var insideTag = highlight(
		"<cfcomponent>\n\t<cfscript>\n\t\tfinal var X = 1;\n\t\tinclude \"/x.cfm\";\n\t\ty = a?.b;\n\t</cfscript>\n</cfcomponent>",
		"cfc"
	);
	assertEqual("tag-based file still routes to the tag grammar",
		insideTag.resolvedLanguage, "embedding.cfml");
	assertEqual("grammar reaches cfscript nested in tags",
		insideTag.html.includes("<span class=\"pl-k\">final</span>"), true);
	assertEqual("include patch reaches cfscript nested in tags",
		insideTag.html.includes("<span class=\"pl-ent\">include</span>"), true);
	assertEqual("safe-navigation patch reaches cfscript nested in tags",
		insideTag.html.includes("<span class=\"pl-k\">?.</span>"), true);

	// -- tag islands --------------------------------------------------------------

	// Lucee tag islands: tag syntax between ``` fences, inside script. Upstream
	// ships the rule in the tag grammar only, wired only at top-of-script; the
	// tag-island patch ports it to the cfs file and wires BOTH files into the
	// statement dispatch. Asserted inside a function body because that is the
	// case upstream gets wrong in both grammars -- and where a cfquery island
	// actually lives.
	var island = highlight(
		"component {\n\tfunction getTasks() {\n\t\t```\n\t\t<cfquery name=\"q\">\n\t\t\tSELECT\n\t\t\t\tt.id\n\t\t\tFROM\n\t\t\t\ttask t\n\t\t</cfquery>\n\t\t```\n\t}\n}",
		"cfc"
	);

	assertEqual("island component routes to the script grammar",
		island.resolvedLanguage, "embedding.cfml.cfs");
	assertEqual("island cfquery is a tag",
		island.html.includes("<span class=\"pl-ent\">cfquery</span>"), true);
	assertEqual("island cfquery embeds SQL",
		island.html.includes("<span class=\"pl-k\">SELECT</span>"), true);
	// The failure mode all of this exists to prevent: the tag-in-script
	// attribute scanner marking the SQL invalid.illegal -> pl-ii, white on red.
	assertEqual("island body carries no illegal tokens",
		island.html.includes("pl-ii"), false);

	// The same island nested in <cfscript> in a TAG file. The rule is
	// upstream's own here, but reaching it from a function body is the patch's
	// wiring, so this direction gets its own assertion.
	var islandInTag = highlight(
		"<cfscript>\ncomponent {\n\tfunction getTasks() {\n\t\t```\n\t\t<cfquery name=\"q\">\n\t\t\tSELECT t.id FROM task t\n\t\t</cfquery>\n\t\t```\n\t}\n}\n</cfscript>",
		"cfm"
	);

	assertEqual("island in a tag-file function embeds SQL",
		islandInTag.html.includes("<span class=\"pl-k\">SELECT</span>"), true);
	assertEqual("island in a tag-file function carries no illegal tokens",
		islandInTag.html.includes("pl-ii"), false);

	// -- bad ampersand ------------------------------------------------------------

	// cfmleditor brands every `&` that is not a complete entity as
	// invalid.illegal -> pl-ii, which lights up twenty years of
	// `href="?a=1&b=2"` URLs as errors. GitHub's text.html.basic renders the
	// same ampersand plain, and the bad-ampersand patch restores that. Both
	// HTML contexts are asserted because each has its own copy of the rule set.
	var ampersand = highlight("<a href=\"./spa.cfm?showBanner=1&spaRoute=/x\">Goto</a> &rarr;", "cfm");
	assertEqual("bare & in an attribute is not illegal",
		ampersand.html.includes("pl-ii"), false);
	// The patch must delete ONLY the catch-all: real character references keep
	// their highlighting, or the patch has cut too deep.
	assertEqual("&rarr; is still a character reference",
		ampersand.html.includes("<span class=\"pl-en\">rarr</span>"), true);

	var ampersandInCfoutput = highlight("<cfoutput><a href=\"?a=#x#&b=2\">x</a> & &rarr;</cfoutput>", "cfm");
	assertEqual("bare & inside cfoutput is not illegal",
		ampersandInCfoutput.html.includes("pl-ii"), false);
	assertEqual("&rarr; inside cfoutput is still a character reference",
		ampersandInCfoutput.html.includes("<span class=\"pl-en\">rarr</span>"), true);

	// -- custom tag digits --------------------------------------------------------

	// Custom tag names may contain digits (`<html:h1>` via cfimport, `<cf_h1>`),
	// but upstream's name classes are `[a-z_-]`, so the digit fell into the
	// attribute scanner and rendered invalid.illegal -> pl-ii mid-name. The
	// custom-tag-digits patch widens the name classes. Open and close tags are
	// separate rules, so both are asserted.
	var digitTag = highlight("<html:h1 margins=\"none\">x</html:h1> <cf_h1>y</cf_h1>", "cfm");
	assertEqual("digit in a prefixed custom-tag name is not illegal",
		digitTag.html.includes("pl-ii"), false);
	assertEqual("prefixed custom-tag name includes its digit",
		digitTag.html.includes("<span class=\"pl-ent\">html:h1</span>"), true);
	assertEqual("cf_ custom-tag name includes its digit",
		digitTag.html.includes("<span class=\"pl-ent\">cf_h1</span>"), true);

	// -- function metadata --------------------------------------------------------

	// CFML function metadata -- attributes between the signature and the body --
	// can carry full expressions. Upstream's attribute rule stops unquoted
	// values at whitespace, so a call's arguments landed on the invalid.illegal
	// catch-all. The function-metadata patch re-points the region at upstream's
	// expression-aware attribute rule (the one tag-in-script already uses).
	var metadata = highlight(
		"<cfscript>\npublic void function f() cachedWithin = createTimeSpan( 0, 0, 1, 0 ) hint = \"x\" {\n}\n</cfscript>",
		"cfm"
	);
	assertEqual("call expression in function metadata is not illegal",
		metadata.html.includes("pl-ii"), false);
	assertEqual("function metadata attribute name survives the swap",
		metadata.html.includes("<span class=\"pl-e\">cachedWithin</span>"), true);
	assertEqual("call arguments in function metadata are constants",
		metadata.html.includes("<span class=\"pl-c1\">1</span>"), true);
	assertEqual("string metadata value after a call value still highlights",
		metadata.html.includes("<span class=\"pl-pds\">\"</span>x<span class=\"pl-pds\">\"</span>"), true);

	// -- comment hyphens ----------------------------------------------------------

	// Hyphen-run divider comments -- `<!-- ------- -->`, the archive's house
	// style -- rendered invalid.illegal -> pl-ii because the comment rule brands
	// every inner `--` illegal. The comment-hyphens patch deletes that catch-all;
	// the run falls through to the enclosing comment scope. Deliberately NOT
	// GitHub's rendering (text.html.basic has the same strictness): correct
	// beats parity. Both HTML contexts are asserted because each has its own
	// copy of the comment rule.
	var divider = highlight("<!-- ------- -->\n<div>x</div>", "cfm");
	assertEqual("hyphen-run divider comment is not illegal",
		divider.html.includes("pl-ii"), false);
	assertEqual("divider renders as one comment",
		divider.html.includes("<span class=\"pl-c\">&lt;!-- ------- --&gt;</span>"), true);
	// The comment must still END at `-->` -- the patch removes an inner rule,
	// not the terminator -- or the markup after it would be swallowed.
	assertEqual("markup after the divider is still a tag",
		divider.html.includes("<span class=\"pl-ent\">div</span>"), true);

	var dividerInCfoutput = highlight("<cfoutput><!-- ------- -->#x#</cfoutput>", "cfm");
	assertEqual("divider comment inside cfoutput is not illegal",
		dividerInCfoutput.html.includes("pl-ii"), false);

	// -- bad angle bracket ----------------------------------------------------------

	// A `<` that opens no tag rendered invalid.illegal -> pl-ii, which lights up
	// SQL comparison operators inside cfquery bodies -- `piv.id < 82`,
	// `date_started <= NOW()`, `id <> 5`. The bad-angle-bracket patch deletes
	// the `<` and `<>` catch-alls; the operators fall through to plain text.
	// Both HTML contexts are asserted because each has its own copy of the pair.
	var angle = highlight("WHERE\n\tid < 82\nAND\n\tstate <> 'x'\nAND\n\tstarted <= NOW()", "cfm");
	assertEqual("SQL comparison operators are not illegal",
		angle.html.includes("pl-ii"), false);

	var angleInCfoutput = highlight("<cfoutput>id < #max# AND a <> b</cfoutput>", "cfm");
	assertEqual("SQL comparison operators inside cfoutput are not illegal",
		angleInCfoutput.html.includes("pl-ii"), false);

	// The patch must delete ONLY the catch-alls: a `<` that DOES open a tag is
	// claimed by earlier rules, or the patch has cut too deep.
	var angleTag = highlight("a < b\n<div class=\"x\">hi</div>", "cfm");
	assertEqual("bare < before a real tag is not illegal",
		angleTag.html.includes("pl-ii"), false);
	assertEqual("real tag after a bare < still highlights",
		angleTag.html.includes("<span class=\"pl-ent\">div</span>"), true);

	// -- doctype capture ------------------------------------------------------------

	// The SGML rule's doctype sub-rule assigns its scope to capture group 1 of
	// a begin regex with no capture group, so the keyword rendered plain while
	// the DTD strings beside it highlighted. The doctype-capture patches (one
	// per grammar layer) add the parentheses upstream forgot. GitHub ships the
	// same dead rule, so this diverges from GitHub: correct beats parity.
	var doctypeSource = "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Strict//EN\">\n<html></html>";

	var doctypeInCfm = highlight(doctypeSource, "cfm");
	assertEqual("cfm doctype keyword is a tag name",
		doctypeInCfm.html.includes("<span class=\"pl-ent\">DOCTYPE</span>"), true);
	assertEqual("cfm DTD identifier is still a string",
		doctypeInCfm.html.includes("<span class=\"pl-s\">\"-//W3C//DTD XHTML 1.0 Strict//EN\"</span>"), true);

	var doctypeInCfoutput = highlight(`<cfoutput>${doctypeSource}</cfoutput>`, "cfm");
	assertEqual("doctype inside cfoutput is a tag name",
		doctypeInCfoutput.html.includes("<span class=\"pl-ent\">DOCTYPE</span>"), true);

	var doctypeInHtm = highlight("<!doctype html>\n<html></html>", "htm");
	assertEqual("lowercase html5 doctype is a tag name",
		doctypeInHtm.html.includes("<span class=\"pl-ent\">doctype</span>"), true);

	// The same gap in the STOCK html grammar, patched by src/grammars/html.js
	// (the patch is applied to a clone before createStarryNight, so it must be
	// visible through an ordinary `htm` fence).
	var dividerInHtm = highlight("<!-- ------- -->\n<div>x</div>", "htm");
	assertEqual("htm fence resolves to the stock html grammar",
		dividerInHtm.resolvedLanguage, "text.html.basic");
	assertEqual("divider comment in html is not illegal",
		dividerInHtm.html.includes("pl-ii"), false);
	assertEqual("divider in html renders as one comment",
		dividerInHtm.html.includes("<span class=\"pl-c\">&lt;!-- ------- --&gt;</span>"), true);
	assertEqual("markup after the html divider is still a tag",
		dividerInHtm.html.includes("<span class=\"pl-ent\">div</span>"), true);

	// -- template property ----------------------------------------------------------

	// An inline component template -- the `template:` property of an object
	// literal -- rendered as one flat string because Microsoft's grammar has no
	// embedded-language support in template literals. The template-property
	// patch (src/grammars/html.js) hands a string value's content to
	// text.html.basic. The archive writes the delimiter both on the same line
	// as the key and on the next line, so both are asserted.
	var templateNextLine = highlight(
		"@Component({\n\tselector: \"my-app\",\n\ttemplate:\n\t`\n\t\t<a (click)=\"go()\">Go</a>\n\t`\n})\nexport class AppComponent {}",
		"ts"
	);
	assertEqual("ts fence resolves to the stock typescript grammar",
		templateNextLine.resolvedLanguage, "source.ts");
	assertEqual("next-line template markup renders as a tag",
		templateNextLine.html.includes("<span class=\"pl-ent\">a</span>"), true);
	// Angular binding syntax deliberately renders as a GENERIC attribute --
	// see patchTemplateProperty for why -- but it must at least tokenize
	// cleanly rather than derail the tag.
	assertEqual("(click) binding renders as an attribute",
		templateNextLine.html.includes("<span class=\"pl-e\">(click)</span>"), true);
	assertEqual("inline template carries no illegal tokens",
		templateNextLine.html.includes("pl-ii"), false);

	var templateSameLine = highlight(
		"var directive = {\n\ttemplate: \"<div class='box'>Hi</div>\",\n\trestrict: \"E\"\n};",
		"ts"
	);
	assertEqual("same-line quoted template markup renders as a tag",
		templateSameLine.html.includes("<span class=\"pl-ent\">div</span>"), true);
	assertEqual("sibling keys after the template still highlight",
		templateSameLine.html.includes("<span class=\"pl-pds\">\"</span>E<span class=\"pl-pds\">\"</span>"), true);

	// The rule must claim ONLY a string value of exactly `template:` -- a
	// call-expression value falls through to the ordinary expression rules,
	// and a prefixed key stays an ordinary string.
	var templateExpression = highlight("var o = {\n\ttemplate: getTemplate( id )\n};", "ts");
	assertEqual("call-expression template value still renders as a call",
		templateExpression.html.includes("<span class=\"pl-en\">getTemplate</span>"), true);

	var templatePrefixed = highlight("var o = {\n\tx_template: `<div>hi</div>`\n};", "ts");
	assertEqual("prefixed template key keeps its plain string value",
		templatePrefixed.html.includes("pl-ent"), false);

	// -- method name lists ------------------------------------------------------------

	// Both JavaScript grammars guessed a dot-method's meaning from name lists,
	// so a jQuery chain alternated colors: `.attr(` was a plain function while
	// `.click(` collided with the DOM roster and rendered as a built-in. The
	// method-name-lists patch (src/grammars/html.js) deletes the lists so every
	// dot-method name gets the same entity.name.function scope. This diverges
	// from GitHub, which keeps the alternating colors.
	var chainSource = "menuRoot\n\t.attr( \"href\", \"x\" )\n\t.click( handleClick );";

	var chainInJs = highlight(chainSource, "js");
	assertEqual("js fence resolves to the stock javascript grammar",
		chainInJs.resolvedLanguage, "source.js");
	assertEqual("unlisted method in a js chain is a function name",
		chainInJs.html.includes("<span class=\"pl-en\">attr</span>"), true);
	assertEqual("DOM-colliding method in a js chain is the same function scope",
		chainInJs.html.includes("<span class=\"pl-en\">click</span>"), true);

	var chainInTs = highlight(chainSource, "ts");
	assertEqual("unlisted method in a ts chain is a function name",
		chainInTs.html.includes("<span class=\"pl-en\">attr</span>"), true);
	assertEqual("DOM-colliding method in a ts chain is the same function scope",
		chainInTs.html.includes("<span class=\"pl-en\">click</span>"), true);

	// The DOM property roster in source.js also steals CALLED names -- `.text(`
	// collides with the `text` property -- so those rules gain a
	// not-followed-by-a-paren guard. An actual property access keeps its
	// built-in scope.
	var propertySteal = highlight("jRow.find( \"td\" ).text( value );\nanchor.href = url;", "js");
	assertEqual("property-colliding method in a js chain is a function name",
		propertySteal.html.includes("<span class=\"pl-en\">text</span>"), true);
	assertEqual("uncalled property access is still a built-in",
		propertySteal.html.includes("<span class=\"pl-c1\">href</span>"), true);

	// The patch must delete ONLY the dot-method lists. Rules keyed on an actual
	// global receiver and the bare-global call lists are knowledge, not
	// guesswork, and stay built-ins.
	var keptBuiltins = highlight("console.log( \"x\" );\nsetTimeout( run, 100 );", "js");
	assertEqual("console method is still a built-in",
		keptBuiltins.html.includes("<span class=\"pl-c1\">log</span>"), true);
	assertEqual("bare global call is still a built-in",
		keptBuiltins.html.includes("<span class=\"pl-c1\">setTimeout</span>"), true);

	// A script island in a CFML page uses the vendored grammars' own copy of
	// the JavaScript rules, patched separately in src/grammars/cfml.js.
	var chainInCfm = highlight(`<script type="text/javascript">\n${chainSource}\n</script>`, "cfm");
	assertEqual("DOM-colliding method in an embedded js chain is a function name",
		chainInCfm.html.includes("<span class=\"pl-en\">click</span>"), true);

	// ---------------------------------------------------------------------------

	// Every patch must have actually run on both files. A patch that silently
	// stops applying looks fixed and is not, and the anchor assertions inside
	// src/grammars/cfml.js only fire if the ANCHOR moved -- not if someone quietly
	// drops a patch from the list.
	assertEqual("every vendored grammar is patched",
		[...cfmlPatches.values()].map((names) => names.join(",")).join(" | "),
		"bare-include,safe-navigation,tag-island,bad-ampersand,custom-tag-digits,function-metadata,comment-hyphens,bad-angle-bracket,doctype-capture,method-name-lists | bare-include,safe-navigation,tag-island,bad-ampersand,custom-tag-digits,function-metadata,comment-hyphens,bad-angle-bracket,doctype-capture,method-name-lists");

	// Same pin for the stock-grammar patch layer (src/grammars/html.js).
	assertEqual("every stock grammar is patched",
		[...stockPatches.entries()].map(([scope, names]) => `${scope}:${names.join(",")}`).join(" | "),
		"source.js:method-name-lists | source.ts:template-property,method-name-lists | text.html.basic:comment-hyphens,doctype-capture");

	// The vendored files are byte-identical to upstream, and this is what makes
	// that a fact rather than an intention. Both patches are applied to the
	// PARSED JSON in memory, never to the files on disk, so any change here is
	// either a deliberate upstream update or someone hand-editing a 600 KB
	// generated file at midnight to make one token render differently.
	//
	// The second is the case worth catching. It works, it survives a test run
	// that only checks patches and output, and it turns the next upstream update
	// into a conflict against something unreadable -- by which time nobody
	// remembers what was changed or why.
	//
	// These hashes are published in LICENSES/README.md and src/grammars/cfml.js.
	// A deliberate update means changing them in all three places, in the same
	// commit as the new files.
	for (var [file, expected] of Object.entries(SOURCES)) {
		var bytes = await readFile(new URL(file, GRAMMARS));
		var actual = createHash("sha256").update(bytes).digest("hex");

		assertEqual(`vendored unmodified: ${file}`, actual, expected);
	}

	// Recorded, not endorsed. These resolve to grammars that are almost
	// certainly not what the author meant, and they are left alone because
	// unlike `txt` there is no documented intent to overrule and the tags are
	// plausible in their own right. If the archive scan turns up real uses,
	// override them the way `txt` is overridden. If these values ever change,
	// that is worth knowing rather than absorbing silently.
	assertEqual("known wart: \"snippet\"", highlight("x", "snippet").resolvedLanguage, "source.yasnippet");
	assertEqual("known wart: \"tpl\"", highlight("x", "tpl").resolvedLanguage, "source.go-template");
}

// ---------------------------------------------------------------------------

console.log("");

if (UPDATE) {
	console.log(`UPDATED -- ${updated} golden file(s) rewritten. Read the diff before committing.`);
} else {
	console.log(failures === 0 ? "PASS -- corpus clean" : `FAIL -- ${failures} assertion(s)`);
}

console.log("");

process.exit(failures === 0 ? 0 : 1);

function fail(name, detail) {
	failures++;
	console.log(`  FAIL  ${name}`);

	if (detail) console.log(`        ${detail}`);
}

function pass(name) {
	console.log(`  ok    ${name}`);
}

function assertEqual(name, actual, expected) {
	if (actual === expected) return pass(name);

	fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertThrows(name, fn, fragment) {
	try {
		fn();
	} catch (error) {
		if (error.message.includes(fragment)) return pass(name);

		return fail(name, `threw, but without naming ${fragment}: ${error.message}`);
	}

	fail(name, "expected a throw, got none");
}

/**
* Import the real server adapter in a child process whose environment has
* `overrides` applied on top of this process's env, and assert the child exits
* non-zero with an error naming the broken variable. Importing IS booting --
* the adapter awaits boot() at module scope -- and exit code plus stderr are
* the whole contract, the same signal Docker and a failed Lambda INIT act on.
*
* The timeout is the failure mode for a regression: if boot() stopped
* refusing, the adapter would bind its port and the child would never exit.
*/
async function assertBootRefuses(name, overrides) {
	var variable = Object.keys(overrides)[0];
	var script = `await import("${SERVER_ADAPTER.href}");`;

	try {
		await execFileAsync(
			process.execPath,
			["--input-type=module", "-e", script],
			{env: {...process.env, ...overrides}, timeout: 15000}
		);
	} catch (error) {
		if (error.stderr.includes(variable)) return pass(name);

		return fail(name, `refused, but without naming ${variable}: ${error.stderr.slice(0, 200)}`);
	}

	fail(name, "expected boot() to refuse, and it booted");
}

/**
* Report the first difference rather than dumping two multi-kilobyte strings.
* A golden-file mismatch is usually a handful of characters and the useful
* information is where, not what.
*/
function diffAt(actual, expected) {
	var limit = Math.min(actual.length, expected.length);
	var index = 0;

	while (index < limit && actual[index] === expected[index]) index++;

	var window = 60;
	var start = Math.max(0, index - window / 2);

	return [
		`first difference at offset ${index} (expected ${expected.length} bytes, got ${actual.length})`,
		`  expected: …${expected.slice(start, start + window)}…`,
		`  actual:   …${actual.slice(start, start + window)}…`
	].join("\n        ");
}
