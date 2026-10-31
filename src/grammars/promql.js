/**
* PromQL, the Prometheus query language. Written for this repo: Linguist ships
* no PromQL grammar, so starry-night has none to patch.
*
* Unlike the cfmleditor grammars beside this file, nothing here is vendored or
* hashed -- this module IS the source, and changes are made by editing it.
*
* SCOPES, AS A READER SEES THEM
*
*   function calls          `rate(`, `histogram_quantile(`     pl-en
*   aggregation operators   `sum`, `topk`, ...                   pl-k
*   clause keywords         `by`, `without`, `on`, `offset`, ... pl-k
*   label names             in `{...}` and in `by (...)` lists   pl-e
*   operators               `=~`, `!=`, `+`, `and`, `@`, ...     pl-k
*   numbers, durations      `0.95`, `5m`, `1h30m`, `Inf`         pl-c1
*   strings                 all three quote forms                pl-s
*   comments                `# ...`                              pl-c
*
* Metric names are deliberately unscoped: they are the bulk of every query, and
* plain text is what keeps the operators and functions around them readable.
*
* Function calls are recognised by the `(` that follows the name rather than by
* a list of names, so a function added to Prometheus highlights without a change
* here. That only works because PromQL has no other construct in which a name
* precedes `(` -- the keywords that do (`by (`, `on (`, `bool (`) are matched
* before the call rule, and the rule order in `patterns` is load-bearing.
*
* Every keyword rule is bounded by `(?<![\w:])` and `(?![\w:])` rather than `\b`,
* because `:` is legal inside a metric name: `\bsum\b` would claim the tail of
* a recording rule such as `job:sum`.
*/

// A name boundary that treats `:` as part of the name. See above.
var START = "(?<![\\w:])";
var END = "(?![\\w:])";

var AGGREGATIONS = [
	"avg", "bottomk", "count", "count_values", "group", "limit_ratio",
	"limitk", "max", "min", "quantile", "stddev", "stdvar", "sum", "topk"
];

/** @type {import("@wooorm/starry-night").Grammar} */
export var promql = {
	scopeName: "source.promql",
	names: ["promql"],
	extensions: [".promql"],
	dependencies: [],
	patterns: [
		{include: "#comment"},
		{include: "#string"},
		{include: "#label-matchers"},
		{include: "#label-list"},
		{include: "#keyword"},
		{include: "#aggregation"},
		{include: "#function-call"},
		{include: "#number"},
		{include: "#metric-name"},
		{include: "#operator"}
	],
	repository: {
		"comment": {
			match: "(#).*$",
			name: "comment.line.number-sign.promql",
			captures: {
				1: {name: "punctuation.definition.comment.promql"}
			}
		},
		// Double- and single-quoted strings also end at the end of the line:
		// Prometheus rejects a newline inside them, and without the `$` one
		// stray quote turns every line below it into a string. Raw strings may
		// span lines, so the backtick rule does not get the `$`.
		"string": {
			patterns: [
				{
					begin: "\"",
					end: "\"|$",
					name: "string.quoted.double.promql",
					beginCaptures: {0: {name: "punctuation.definition.string.begin.promql"}},
					endCaptures: {0: {name: "punctuation.definition.string.end.promql"}},
					patterns: [{include: "#string-escape"}]
				},
				{
					begin: "'",
					end: "'|$",
					name: "string.quoted.single.promql",
					beginCaptures: {0: {name: "punctuation.definition.string.begin.promql"}},
					endCaptures: {0: {name: "punctuation.definition.string.end.promql"}},
					patterns: [{include: "#string-escape"}]
				},
				// Raw: no escapes are processed between backticks.
				{
					begin: "`",
					end: "`",
					name: "string.quoted.other.raw.promql",
					beginCaptures: {0: {name: "punctuation.definition.string.begin.promql"}},
					endCaptures: {0: {name: "punctuation.definition.string.end.promql"}}
				}
			]
		},
		"string-escape": {
			match: "\\\\(?:[abfnrtv\\\\\"']|x\\h{2}|u\\h{4}|U\\h{8}|[0-7]{3})",
			name: "constant.character.escape.promql"
		},
		// The selector braces: `{job="api", code=~"5.."}`. Inside them every name
		// is a label, so none of the top-level keyword rules may apply -- `group`
		// and `offset` are ordinary label names here.
		"label-matchers": {
			begin: "\\{",
			end: "\\}",
			beginCaptures: {0: {name: "punctuation.section.braces.begin.promql"}},
			endCaptures: {0: {name: "punctuation.section.braces.end.promql"}},
			patterns: [
				{include: "#comment"},
				{include: "#string"},
				{include: "#label-name"},
				{
					match: "=~|!~|!=|=",
					name: "keyword.operator.match.promql"
				}
			]
		},
		// The parenthesised label lists that follow a clause keyword:
		// `by (job)`, `on (instance)`, `group_left (version)`.
		"label-list": {
			begin: `(?i)${START}(by|without|on|ignoring|group_left|group_right)\\s*(\\()`,
			end: "\\)",
			beginCaptures: {
				1: {name: "keyword.other.promql"},
				2: {name: "punctuation.section.parens.begin.promql"}
			},
			endCaptures: {0: {name: "punctuation.section.parens.end.promql"}},
			patterns: [
				{include: "#comment"},
				{include: "#string"},
				{include: "#label-name"}
			]
		},
		"label-name": {
			match: "[a-zA-Z_][a-zA-Z0-9_]*",
			name: "entity.other.attribute-name.label.promql"
		},
		// `group_left` and `group_right` reach here only when written without a
		// label list; with one, `label-list` has already claimed them.
		"keyword": {
			patterns: [
				{
					match: `(?i)${START}(?:and|or|unless)${END}`,
					name: "keyword.operator.logical.promql"
				},
				{
					match: `(?i)${START}atan2${END}`,
					name: "keyword.operator.arithmetic.promql"
				},
				{
					match: `(?i)${START}(?:bool|offset|group_left|group_right)${END}`,
					name: "keyword.other.promql"
				}
			]
		},
		// Only when followed by `(` or a `by`/`without` clause, so a metric that
		// happens to be named `count` or `group` stays a metric.
		"aggregation": {
			match: `(?i)${START}(?:${AGGREGATIONS.join("|")})${END}(?=\\s*(?:\\(|(?:by|without)${END}))`,
			name: "keyword.operator.aggregation.promql"
		},
		"function-call": {
			match: `${START}[a-zA-Z_][a-zA-Z0-9_]*(?=\\s*\\()`,
			name: "entity.name.function.promql"
		},
		"number": {
			patterns: [
				// The lookbehind admits `:` -- a subquery step follows one,
				// `[1h:5m]` -- which is safe because a name containing a colon has
				// already been consumed whole by `metric-name`.
				{
					match: "(?<![\\w.])(?:\\d+(?:ms|[smhdwy]))+(?![\\w.])",
					name: "constant.numeric.duration.promql"
				},
				{
					match: "(?<![\\w.])(?:0[xX]\\h+|(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?)(?![\\w.])",
					name: "constant.numeric.promql"
				},
				{
					match: `(?i)${START}(?:inf|nan)${END}`,
					name: "constant.language.promql"
				}
			]
		},
		// Consumed whole, without a scope. The rules above already refuse to
		// start inside a name; this one is for a colon-separated segment that
		// begins with a digit, so the `5m` in `foo:5m` is not read as a
		// duration.
		//
		// Do not admit a leading `:`, although Prometheus allows one: this rule
		// would then claim `:30s` in a subquery `[1h:30s]` and leave the step
		// unhighlighted.
		"metric-name": {
			match: "[a-zA-Z_][a-zA-Z0-9_:]*"
		},
		"operator": {
			match: "==|!=|>=|<=|=~|!~|[-+*/%^<>@]",
			name: "keyword.operator.promql"
		}
	}
};
