/**
* CSS nesting for `source.css`, a port of microsoft/vscode-css's change to the
* same grammar. It has a file of its own, apart from the other CSS patches in
* css.js, so that a diff against extensions/css/syntaxes/css.tmLanguage.json
* in the vscode repository is this whole file and nothing else.
*/

import {find} from "./walk.js";

/**
* A nested rule inside a CSS block renders as a broken declaration.
*
* The stock grammar predates CSS nesting: the contents of a `{}` block are
* parsed as declarations only, so in
*
*   .textBlock * {
*     &:focus,
*     &:focus-visible {
*       animation-name: none;
*     }
*   }
*
* the `&` matches nothing, the `:` opens a property value that runs to the
* next `;`, and `focus, &:focus-visible { animation-name` is swallowed as that
* value. A nested `.b { color: red; }` is worse: `b` colors as a property
* name and the inner `}` closes the OUTER rule, so everything after it parses
* at the wrong level. Found via fixture 4864-2.css.
*
* Upstream (atom/language-css) is archived and will not get this; Linguist and
* starry-night still track it. Microsoft's fork of the same grammar
* (microsoft/vscode-css) added nesting, and this patch ports that change:
*
* - `&` in a selector scopes entity.name.tag.nesting.css -> pl-ent, the same
*   color as `*` and element names, matching SCSS's `&`.
* - A selector may start with `&`, and `&` no longer marks a class or id
*   invalid (only `&` followed by an identifier is: `.a&b`).
* - A block's contents also try #selector, so a nested rule opens a nested
*   block. Telling `a:hover {` from `color: red;` is the whole difficulty; the
*   fork's selector `begin` rejects anything on the line that reads as a
*   declaration (a colon followed by whitespace, a `;` or `}` before any `{`),
*   and known property names are tried before the selector so `color:red`
*   with no space still colors as a property.
* - The names that are both an element and a property (span, mask, filter,
*   font, content, ...) get a dedicated rule (#shared-names) that reads them
*   as a selector unless the line reads as a declaration. The two lists are
*   exactly the intersection of the grammar's tag-names and property-names
*   alternations, which the patch verifies against both regexes.
* - The body of a nested `@media`, of a nested `@supports`, and of any
*   at-rule the grammar has no dedicated rule for also tries declarations, so
*   `.a { @media (...) { color: blue; } }` colors its declaration.
*
* The regex text below is the fork's, `(?x)` comments included, with TWO
* deviations. The fork leaves the `@supports` body dispatching to `$self`
* alone, so `.a { @supports (...) { color: blue; } }` colors nothing there
* while the same line under `@media` colors; this patch treats the three
* bodies alike. And #shared-names rejects a name on "a `;` before any `{`",
* where the fork rejects on "a `;` anywhere on the line". The fork's test reads a
* one-line nested rule -- `span { color: red; }` -- as the property `span`,
* whose value then runs to the `;` and whose `}` closes the ENCLOSING block,
* so every line after it parses at the wrong level. The selector rule's own
* test is already "before any `{`"; this makes the two agree. Otherwise do not
* tidy the regex text into local style: keeping it comparable to
* extensions/css/syntaxes/css.tmLanguage.json in the vscode repository is
* what makes the next upstream diff readable.
*/
export var patchNesting = {
	name: "nesting",
	branches: new Map([
		["source.css", nestingInCss]
	])
};

function nestingInCss(grammar) {
	var repo = grammar.repository;
	var NESTING = "entity.name.tag.nesting.css";

	// -- selector: may start with `&`, must not read as a declaration --------------

	var selector = repo.selector;

	if (
		!selector.begin.startsWith("(?x)\n(?=\n  (?:\\|)?")
		|| selector.end !== "(?=\\s*[/@{)])"
	) {
		throw new Error(`${grammar.scopeName}: the selector rule no longer has the expected begin/end; re-derive nestingInCss`);
	}

	selector.begin = [
		"(?xi)",
		"# Match must be preceded by one of the following:",
		"(?<=",
		"    ^                             # Start of line",
		"  | (^|[^\\:])\\s                 # Whitespace, after the start of a line or any character except a colon (which denotes a property)",
		"  | ;                             # Semicolon (condensed property list syntax)",
		"  | [{}]                          # Opening or closing brace (condensed property list syntax)",
		"  | \\*/                          # Comment end",
		"  | \\\\(?:[0-9a-fA-F]{1,6}|.)    # Escape sequence",
		")",
		"",
		"# Match may contain any of the following:",
		"(?=",
		"  (?:",
		"    # Match must start with one of the following:",
		"      &                           # Nesting selector",
		"    | \\*                         # Universal selector",
		"    | [>~+]                       # Selector combinator",
		"    | \\|                         # Selector namespace separator",
		"    | \\[                         # Attribute selector opening bracket",
		"    | [a-zA-Z]                    # Letter",
		"    | [^\\x00-\\x7F]              # Non-ASCII symbols",
		"    | \\\\(?:[0-9a-fA-F]{1,6}|.)  # Escape sequence",
		"",
		"    # Or one of the following symbols, followed by a word character, hyphen, or escape sequence:",
		"    | (?:",
		"          \\.                     # Class selector",
		"        | \\#                     # ID selector",
		"      )",
		"      (?:",
		"          [\\w-]                  # Word character or hyphen",
		"        | \\\\(?:                 # Escape sequence",
		"                [0-9a-fA-F]{1,6}",
		"              | .",
		"            )",
		"      )",
		"",
		"    # Or one of the following symbols, followed a letter or hyphen:",
		"    | (?:",
		"          \\:                     # Pseudo-class",
		"        | \\:\\:                  # Pseudo-element",
		"      )",
		"      [a-zA-Z-]                   # Letter or hyphen",
		"  )",
		")",
		"",
		"# Match must NOT contain any of the following:",
		"(?!",
		"    [\\w-]*[\\:]+\\s              # One or more colons immediately followed by a whitespace (denotes a property or invalid sequence)",
		"  | [^{]*;                        # Any characters and a semicolon before an opening bracket (denotes the end of a property)",
		"  | [^{]*}                        # A closing bracket before an opening bracket (denotes a property)",
		"  | [^\\:]+(\\:\\:):+             # More than two colons (invalid sequence)",
		")"
	].join("\n");

	selector.end = [
		"(?x)",
		"# Match must end with:",
		"(?=",
		"  \\s*                            # Optional whitespace and one of the following:",
		"  (?:",
		"      \\/                         # Comment",
		"    | @                           # At-rule",
		"    | {                           # Opening property list brace",
		"    | \\)                         # Closing function brace (for passing test on `some-edgy-new-function(`)",
		"    | $                           # End of line",
		"  )",
		")"
	].join("\n");

	// -- selector-innards: the `&` token, and `&` as a legal neighbor ---------------

	var innards = repo["selector-innards"].patterns;

	var wildcards = innards.filter((p) => p.match === "\\*" && p.name === "entity.name.tag.wildcard.css");

	if (wildcards.length !== 1 || innards.some((p) => p.match === "&")) {
		throw new Error(`${grammar.scopeName}: selector-innards no longer has exactly one wildcard rule and no \`&\` rule; re-derive nestingInCss`);
	}

	innards.splice(innards.indexOf(wildcards[0]), 0, {match: "&", name: NESTING});

	// Each needle is a fragment of one of the fork's edited regexes. The count
	// pins how many rules carry it, so a starry-night upgrade that adds or
	// drops one fails here instead of leaving `&` invalid in that one context.
	function replaceInMatches(needle, replacement, expected) {
		var carriers = innards.filter((p) => typeof p.match === "string" && p.match.includes(needle));

		if (carriers.length !== expected) {
			throw new Error(`${grammar.scopeName}: ${carriers.length} selector-innards rules carry ${JSON.stringify(needle)}, expected ${expected}; re-derive nestingInCss`);
		}

		for (var rule of carriers) {
			rule.match = rule.match.split(needle).join(replacement);
		}
	}

	// The "followed by another selector" class shared by the class, id, and
	// bad-identifier rules: `.foo&` is a valid compound.
	replaceInMatches("[\\s,.\\#)\\[:{>+~|]", "[\\s,.\\#)\\[:{>+~|&]", 3);

	// The namespace-prefix rule's "make sure there's a selector to match".
	replaceInMatches("[-\\[:.*\\#a-zA-Z_]    # Make sure there's a selector to match", "[-\\[:.*&\\#a-zA-Z_]   # Make sure there's a selector to match", 1);

	// The bad-identifier rule's invalid-punctuation class: `&` leaves it, and
	// comes back as its own alternative that only fires before an identifier.
	replaceInMatches("[!\"'%&(*;<?@^`|\\]}]", "[!\"'%(*;<?@^`|\\]}]|&(?=[-a-zA-Z_0-9]|[^\\x00-\\x7F])", 1);

	// -- shared-names: element names that are also property names -----------------

	if (repo["shared-names"]) {
		throw new Error(`${grammar.scopeName}: repository already has shared-names; remove nestingInCss`);
	}

	var PLAIN = ["header", "image", "label", "marquee", "mask", "nav", "ruby", "shadow", "span", "style", "color-profile", "line", "text"];
	var COLONED = ["content", "font", "mark", "cursor", "filter"];

	// Both lists must be exactly the names the grammar's own tag-names and
	// property-names alternations share. Either alternation growing a new
	// collision (or losing one) means the lists here are wrong.
	function alternation(source) {
		return new Set(source.replace(/#[^\n]*/g, "").replace(/\s+/g, "").match(/[a-z][a-z0-9-]*/gi));
	}

	var tags = alternation(repo["tag-names"].match.split("(?:")[1]);
	var properties = alternation(repo["property-names"].patterns[0].match.split("(?:")[1]);
	var shared = [...tags].filter((name) => properties.has(name)).sort().join(",");

	if (shared !== [...PLAIN, ...COLONED].sort().join(",")) {
		throw new Error(`${grammar.scopeName}: tag-names and property-names now share [${shared}]; update the shared-names lists in nestingInCss`);
	}

	var SHARED_PRECEDED_BY = [
		"(?xi)",
		"# Selector match must be preceded by one of the following:",
		"(?<=",
		"    ^                           # Start of line",
		"  | (^|[^\\:])\\s               # Whitespace, after the start of a line or any character except a colon",
		"  | [{}]                        # Opening or closing brace (condensed property list syntax)",
		"  | \\*/                        # Comment end",
		"  | \\\\(?:[0-9a-fA-F]{1,6}|.)  # Escape sequence",
		")",
		""
	].join("\n");

	var SHARED_END = [
		"(?xi)",
		"# Selector match ends with one of the following:",
		"(?=",
		"    \\s                           # Whitespace",
		"  | \\/\\*                        # Comment",
		"  | ,                             # Comma",
		"  | {                             # Opening property list brace",
		"  | $                             # End of line",
		")"
	].join("\n");

	repo["shared-names"] = {
		patterns: [
			{
				begin: SHARED_PRECEDED_BY + [
					"(?=",
					"  # Selector must match:",
					"  (?:",
					"    # HTML elements",
					"    header|image|label|marquee|mask|nav|ruby|shadow|span|style",
					"    # SVG elements",
					"    |color-profile|line|text",
					"  )",
					"",
					"  # Selector must NOT be followed by any any of the following:",
					"  (?!",
					"      [^{]*;                    # A semicolon before any opening brace (denotes a property)",
					"    | [^{]*}                    # Any characters, except an opening brace, followed by a closing bracket (denotes a property)",
					"    | -                         # A dash (denotes a property name)",
					"    | \\:\\s+                   # A colon followed by whitespace (denotes a property name)",
					"  )",
					")"
				].join("\n"),
				end: SHARED_END,
				patterns: [{include: "#selector"}]
			},
			{
				begin: SHARED_PRECEDED_BY + [
					"(?=",
					"  # Selector must match:",
					"  (?:",
					"    # HTML elements",
					"    content|font|mark",
					"    # SVG elements",
					"    |cursor|filter",
					"  )",
					"",
					"  # Selector must NOT be followed by any any of the following:",
					"  (?!",
					"      [^{]*;                    # A semicolon before any opening brace (denotes a property)",
					"    | [^{]*}                    # Any characters, except an opening brace, followed by a closing bracket (denotes a property)",
					"    | -                         # A dash (denotes a property name)",
					"    | \\:                     # A colon, unless it's with one of the following:",
					"    (?!",
					"      # An opening bracket before a closing bracket",
					"        [^}]*{",
					"      # A pseudo-class selectors",
					"      | active|any-link|checked|disabled|empty|enabled|first",
					"      | (?:first|last|only)-(?:child|of-type)|focus|focus-visible|focus-within|fullscreen|host|hover",
					"      | in-range|indeterminate|invalid|link|out-of-range",
					"      | read-only|read-write|required|root|scope|target|unresolved",
					"      | valid|visited",
					"",
					"      # A functional pseudo-class selectors",
					"      | (?: dir|lang",
					"          | not|has|matches|where|is",
					"          | nth-(?:last-)?(?:child|of-type)",
					"        )\\(",
					"",
					"      # A single-colon pseudo-element selectors",
					"      | after",
					"      | before",
					"      | first-letter",
					"      | first-line",
					"      | (?:",
					"          \\-",
					"          (?:",
					"              ah|apple|atsc|epub|hp|khtml|moz",
					"            | ms|o|rim|ro|tc|wap|webkit|xv",
					"          )",
					"          | (?:",
					"              mso|prince",
					"            )",
					"        )",
					"        -[a-z-]+",
					"    )",
					"  )",
					")"
				].join("\n"),
				end: SHARED_END,
				patterns: [{include: "#selector"}]
			}
		]
	};

	// -- rule-list-innards: try a nested rule before an unknown property ----------

	var list = repo["rule-list-innards"].patterns;

	var wrappers = list.filter((p) => (
		p.name === "meta.property-name.css"
		&& p.begin === "(?<![-a-zA-Z])(?=[-a-zA-Z])"
		&& p.patterns?.length === 1
		&& p.patterns[0].include === "#property-names"
	));

	if (wrappers.length !== 1 || list.some((p) => p.include === "#selector")) {
		throw new Error(`${grammar.scopeName}: rule-list-innards no longer has exactly one property-name wrapper and no #selector; re-derive nestingInCss`);
	}

	// Known property names first, so `color:red` (no space, no `;`) is still a
	// property; then the shared names; then anything selector-shaped; and only
	// then the wrapper, which is left to catch UNKNOWN property names. Its
	// inner include is dropped: every name it could match has already been
	// tried above it.
	list.splice(list.indexOf(wrappers[0]), 0, {include: "#shared-names"}, {include: "#property-names"}, {include: "#selector"});
	delete wrappers[0].patterns;

	// -- rule-list: a nested `{` opens a nested block --------------------------------

	var ruleList = repo["rule-list"].patterns;

	if (ruleList.length !== 1 || ruleList[0].include !== "#rule-list-innards") {
		throw new Error(`${grammar.scopeName}: rule-list no longer dispatches to exactly [#rule-list-innards]; re-derive nestingInCss`);
	}

	// `$self` is the top-level pattern list: it brings #rule-list itself (the
	// nested `{`), #at-rules (a nested `@media`), and #selector again.
	ruleList.push({include: "$self"});

	// -- at-rule bodies: declarations directly inside a nested @media/@supports ---

	// The media body, the supports body and the generic at-rule body (anything
	// without its own rule: @container, @layer, @scope, ...) dispatch to `$self`
	// only, so a declaration written directly inside one is plain text. Nesting
	// makes that the common case. The fork changed the first and last of these;
	// the supports body is this patch's own addition.
	var BODIES = ["meta.at-rule.media.body.css", "meta.at-rule.supports.body.css", "meta.at-rule.body.css"];

	var found = find(repo["at-rules"], (node) => BODIES.includes(node.name));

	if (
		found.length !== BODIES.length
		|| found.some((body) => body.patterns.length !== 1 || body.patterns[0].include !== "$self")
	) {
		throw new Error(`${grammar.scopeName}: at-rules no longer has exactly one each of ${BODIES.join(", ")} dispatching to [$self]; re-derive nestingInCss`);
	}

	for (var body of found) {
		body.patterns.unshift({include: "#rule-list-innards"});
	}
}
