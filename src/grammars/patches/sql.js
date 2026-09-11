/**
* SQL patches. Two grammars carry SQL rules here, and they are not related:
*
*   source.sql            starry-night's stock grammar, the old TextMate
*                         sql.tmbundle, reached by a ```sql fence
*   embedding.cfml(.cfs)  cfmleditor's inlined copy of Microsoft's
*                         vscode-mssql grammar (`source-sql` in the
*                         repository), reached by cfquery bodies and
*                         queryExecute strings
*
*   statement-keywords   `EXPLAIN`, `EXPLAIN ANALYZE`, `WITH` and
*                        `WITH RECURSIVE` color as keywords in a sql fence
*   ddl-keywords         `COLLATE`, `ENGINE`, `DEFAULT` and `CHARSET` color as
*                        keywords in a sql fence and in a cfquery body
*   column-words         common column names are not colored as keywords in
*                        a cfquery body
*/

import {CFML_TAG, CFML_SCRIPT} from "../scopes.js";
import {count} from "./walk.js";

/**
* `EXPLAIN` and `WITH` render as plain text in a `sql` fence.
*
* The stock grammar is the old TextMate sql.tmbundle, whose statement
* keywords are one short DML alternation -- select, insert into, update,
* delete, the joins. Neither word is in it: the bundle predates EXPLAIN's
* spread beyond MySQL and Postgres and predates common table expressions
* altogether, and GitHub ships the same rule, so it leaves both plain too. In
* the archive EXPLAIN opens whole posts about query plans and WITH opens
* every CTE, and an unhighlighted first word above a highlighted SELECT reads
* as a typo.
*
* The patch prepends both to that alternation, with `ANALYZE` and `RECURSIVE`
* folded in the way the rule already folds `union(\s+all)?`: a bare `explain`
* entry would color half of `EXPLAIN ANALYZE` and leave the other half plain,
* and likewise `WITH RECURSIVE`. This DIVERGES from GitHub the way
* comment-hyphens does: correct beats parity.
*
* Only the stock grammar needs this. cfquery bodies and queryExecute strings
* route to cfmleditor's inlined vscode-mssql grammar, whose generic keyword
* list already carries `with` and `recursive` (columnWordsInCfml edits that
* list).
*/
var patchStatementKeywords = {
	name: "statement-keywords",
	branches: new Map([
		["source.sql", statementKeywordsInSql]
	])
};

function statementKeywordsInSql(grammar) {
	var SCOPE = "keyword.other.DML.sql";
	var HEAD = "(?i:\\b(select(\\s+distinct)?|";

	// The DML rule lives in the grammar's top-level patterns, not the repository.
	var rules = grammar.patterns.filter((p) => p.name === SCOPE);

	// Anchor check on the alternation's opening. Anything else means upstream
	// reworked the rule -- re-derive rather than splicing into a stranger. An
	// `explain` or `with` already present means upstream added it; drop that
	// word from this patch.
	if (
		rules.length !== 1
		|| !rules[0].match.startsWith(HEAD)
		|| /\b(explain|with)\b/i.test(rules[0].match)
	) {
		throw new Error(`${grammar.scopeName}: the ${SCOPE} rule no longer has the expected alternation; re-derive statementKeywordsInSql`);
	}

	rules[0].match = `${HEAD}explain(\\s+analyze)?|with(\\s+recursive)?|${rules[0].match.slice(HEAD.length)}`;

	// The top-level rule must be the ONLY carrier of the scope. A second one
	// appearing in a starry-night upgrade would leave EXPLAIN and WITH plain in
	// some context nobody re-tested -- fail loudly instead.
	if (count(grammar, (node) => node.name === SCOPE) !== 1) {
		throw new Error(`${grammar.scopeName}: a ${SCOPE} rule now appears outside the top-level patterns; extend statementKeywordsInSql to cover it`);
	}
}

/**
* `COLLATE`, `ENGINE`, `DEFAULT` and `CHARSET` render as plain text in a
* `sql` fence and inside a cfquery body; `CHARACTER SET` too in the fence.
*
* The stock grammar's DDL coverage is a handful of rules for CREATE, types,
* `PRIMARY KEY` and `NOT NULL`; the table-option and column-option words
* around them are absent, so a MySQL CREATE TABLE ends in a line where only
* the `=` signs are colored, and `slug COLLATE utf8_bin = 'x'` in a WHERE
* clause colors the column and the operator but not the word between them.
* GitHub ships the same rule and renders the same gap. Found via fixtures
* 3918-4.sql and 4233-1.sql.
*
* cfmleditor's inlined vscode-mssql grammar has the same gap for a different
* reason. Its generic keyword list -- the one columnWordsInCfml prunes -- was
* copied from SQL Server Management Studio, and these four are not in it:
* three are MySQL table options SSMS never sees, and DEFAULT is colored there
* by a different mechanism. In this archive a CREATE TABLE inside a cfquery is
* MySQL, and its last line renders with only the `=` signs colored.
*
* All five are reserved in MySQL, and COLLATE and DEFAULT in Postgres, SQL
* Server and SQLite too, so none can be an unquoted column name: coloring
* them cannot misfire the way `name` or `status` would. The collision that
* argues for pruning `name` argues for adding these.
*
* In the stock grammar the words are prepended to the DDL rule that already
* carries `ON` and `NOT NULL`, so they render in that rule's scope beside
* them, with `CHARACTER SET` folded in as one token the way the DML rule folds
* `union(\s+all)?` -- or the stock `SET` rule would color half the phrase. In
* the cfmleditor copy the four words join the generic roster; `CHARACTER SET`
* needs nothing there, both words are already in the list. The collation,
* engine and charset names that follow stay plain in both: they are
* identifiers.
*/
var patchDdlKeywords = {
	name: "ddl-keywords",
	branches: new Map([
		["source.sql", ddlKeywordsInSql],
		[CFML_TAG, ddlKeywordsInCfml],
		[CFML_SCRIPT, ddlKeywordsInCfml]
	])
};

function ddlKeywordsInSql(grammar) {
	var SCOPE = "keyword.other.DDL.create.II.sql";
	var STOCK = "(?i:\\b(on|((is\\s+)?not\\s+)?null)\\b)";
	var HEAD = "(?i:\\b(";

	// Like the DML rule, this one lives in the grammar's top-level patterns.
	var rules = grammar.patterns.filter((p) => p.name === SCOPE);

	// Anchor on the whole stock alternation: it is short enough that any
	// change to it means re-deriving rather than splicing.
	if (rules.length !== 1 || rules[0].match !== STOCK) {
		throw new Error(`${grammar.scopeName}: the ${SCOPE} rule no longer has the expected alternation; re-derive ddlKeywordsInSql`);
	}

	rules[0].match = `${HEAD}collate|engine|default|charset|character\\s+set|${STOCK.slice(HEAD.length)}`;
}

function ddlKeywordsInCfml(grammar) {
	var WORDS = ["collate", "engine", "default", "charset"];

	var roster = sqlKeywordRoster(grammar, "ddlKeywordsInCfml");

	// A word already present means upstream added it; drop it from this list.
	for (var word of WORDS) {
		if (roster.words.includes(word)) {
			throw new Error(`${grammar.scopeName}: source-sql keyword list already contains "${word}"; remove it from ddlKeywordsInCfml`);
		}
	}

	roster.write(roster.words.concat(WORDS));
}

/**
* Column names render as SQL keywords: `SELECT id, name, created` puts `name`
* in the same pl-k as SELECT.
*
* cfmleditor's inlined `source-sql` is Microsoft's vscode-mssql grammar, whose
* generic keyword rule is one ~830-word alternation copied from SQL Server
* Management Studio's coloring list. That list was assembled for SSMS parity,
* not correctness: `name`, `type`, `value`, `status`, `date`, `data` are all
* in it, none is a reserved word in any SQL dialect, and all six are among the
* most common column names there are. Upstream has only ever added to the
* list, and the SSMS behaviour it mirrors is a two-decade-old known quirk, so
* this is not going to be fixed by an update.
*
* Removing the six costs their T-SQL keyword uses -- `WITH (NAME = ...)`,
* `sp_rename ... 'COLUMN'`, `CREATE TYPE`. Those are admin and DDL statements
* that almost never appear in a cfquery body, whereas a SELECT list with one
* of these columns appears in nearly every one. A keyword-list grammar cannot
* tell the two apart, so the roster is a judgment about which usage dominates
* in this archive, not a claim about SQL.
*
* Do not add `key` to the roster, column name though it is. This list matches
* `PRIMARY` before the `primary key` storage-modifier rule further down the
* entry gets a look, so `KEY` in `PRIMARY KEY` is colored by this list alone
* and removing it leaves half the phrase plain in every CREATE TABLE.
*
* Top-level ```sql fences are unaffected: those route to starry-night's stock
* `source.sql` (the old TextMate bundle), whose keyword list has none of these
* words. Only cfquery bodies and queryExecute strings reach this rule.
*/
var patchColumnWords = {
	name: "column-words",
	branches: new Map([
		[CFML_TAG, columnWordsInCfml],
		[CFML_SCRIPT, columnWordsInCfml]
	])
};

function columnWordsInCfml(grammar) {
	var WORDS = ["name", "type", "value", "status", "date", "data"];

	var roster = sqlKeywordRoster(grammar, "columnWordsInCfml");

	// Anchor check: every word to remove must be present exactly once, spelled
	// bare. A word already gone means upstream pruned it and this roster should
	// shrink; a word present twice or wrapped in regex means the list changed
	// shape and a plain string removal is no longer sound.
	for (var word of WORDS) {
		if (roster.words.filter((w) => w === word).length !== 1) {
			throw new Error(`${grammar.scopeName}: source-sql keyword list no longer contains "${word}" exactly once; re-derive columnWordsInCfml`);
		}
	}

	roster.write(roster.words.filter((w) => !WORDS.includes(w)));
}

/**
* The generic keyword alternation of cfmleditor's inlined vscode-mssql grammar
* -- the one ~830-word `keyword.other.sql` rule in source-sql -- with its
* word list split out and a writer that puts a new list back. Shared by the
* two branches that edit the roster; `caller` names the branch for the error
* messages.
*
* The generic rule is the only `keyword.other.sql` rule whose match is a bare
* word alternation -- the DML/DDL siblings carry dotted suffixes
* (keyword.other.DML.sql) and are not what is being edited. It must also be
* the ONLY carrier of that alternation in the whole grammar: a second copy in
* an upstream update would keep the old roster in some context nobody
* re-tested -- fail loudly instead.
*/
function sqlKeywordRoster(grammar, caller) {
	var HEAD = "\\b(?i)(";
	var TAIL = ")\\b";

	function isCarrier(node) {
		return (
			node.name === "keyword.other.sql"
			&& typeof node.match === "string"
			&& node.match.startsWith(HEAD)
			&& node.match.endsWith(TAIL)
		);
	}

	var matches = grammar.repository["source-sql"].patterns.filter(isCarrier);

	if (matches.length !== 1) {
		throw new Error(`${grammar.scopeName}: source-sql no longer has exactly one generic keyword alternation; re-derive ${caller}`);
	}

	if (count(grammar, isCarrier) !== 1) {
		throw new Error(`${grammar.scopeName}: a generic SQL keyword alternation now appears outside source-sql; extend ${caller} to cover it`);
	}

	var rule = matches[0];

	return {
		words: rule.match.slice(HEAD.length, -TAIL.length).split("|"),
		write(words) {
			rule.match = HEAD + words.join("|") + TAIL;
		}
	};
}

// Last in the file: `var` hoists the binding, not the value, so this list has
// to follow the descriptors it names.
export var PATCHES = [patchStatementKeywords, patchColumnWords, patchDdlKeywords];
