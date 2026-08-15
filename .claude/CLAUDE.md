## Basic Etiquette

* When asserting facts about the code, never assume - always check against the code.
* Use fewer words, unless I ask for a more detailed explanation.
* **Never put a reference in a comment that can drift silently.** No line
  numbers, no ticket or issue or PR numbers, no "see above/below", no links to
  anything whose URL encodes a position. Anchor to something greppable instead:
  a symbol name, or a filename. The test is not "will this go stale" -
  everything does - it is "will anything notice." A renamed file breaks loudly
  and gets fixed; a stale line number just quietly lies, and the reader trusts
  it because comments in this repo are usually right.
* **Comments justify the code as it stands - they are not a changelog.** The
  only reason to mention a past state is to stop a specific future change that
  would otherwise look reasonable. "This was fail-open once, and that shipped a
  public service" earns its place, because deleting the check reads as harmless
  cleanup. Renames, moves, extractions, and things deleted that are not coming
  back do not: nobody will rename tools/ back to demo/, so the old name should
  appear nowhere. Before writing "previously", "used to", "no longer", or "now
  lives in", name the change being prevented. If you cannot name one, delete
  the sentence - git already has the history, and nobody reads a comment to
  find out what the code used to be.
* **Do not document absences.** A comment explaining why something is *not*
  there usually invents the question it answers. `TIMEOUT_MS` appeared nowhere
  in this repo except the comment saying it was deliberately absent - the
  comment was the only thing that knew the name existed. The test is whether
  anyone would actually reach for the thing: `version:` in a compose file is
  muscle memory, so its absence reads as an oversight and earns a line; a
  variable this project invented does not.
  When an absence does earn a comment it is usually not an absence at all - it
  is a change someone would make *because it looks like an improvement*:
  destroying the socket after a 413, adding a Content-Length pre-check, listing
  `dist/` in .gitignore. Write those as "do not do X, because Y", not as "there
  is no X". If it cannot be phrased that way, it does not need saying.

## JavaScript Syntax

* **Declare variables with `var`, not `let` or `const`.** Function-scoped
  hoisting is a feature here: `var x = ...` inside a try block is readable
  where a pre-declared `let x` above the block is not. Use `let` only when
  block scoping is doing real work - a per-iteration binding that a closure
  must capture, for example. Do not use `const`.
* **Never write a bare `var x;` just to assign it in a block below.** Declare
  at the first assignment - hoisting already makes it visible after the block,
  so the pre-declaration is pure noise. A bare declaration is legitimate only
  for module state assigned inside one function and read by others, where the
  assignment site is the wrong scope (starryNight in highlight.js is the
  example).
* **An `await` gets its own statement.** Never bury `await` inside a larger
  expression - a call's arguments (`send(await handleRequest(...))`), a method
  chain (`(await readdir(dir)).filter(...)`), or an object literal. Assign the
  awaited value to an intermediary variable first, then use the variable. A
  ternary whose result is assigned directly to a variable is fine.
* **Use double quotes for strings, not single quotes.** Template literals are
  fine when interpolating.
* **End statements with semicolons.** No ASI reliance.

## This repo

* **Anything under `src/` ships in the Lambda zip.** `.dockerignore` denies by
  default and allows `src/` back wholesale. Tests and fixtures live in `test/`
  for that reason; put anything that must not ship outside `src/` rather than
  adding an exclusion rule.
* **Never hand-edit `src/grammars/*.tmLanguage.json`.** They are vendored from
  cfmleditor byte-identical. The two patches we need are applied to the parsed
  JSON at load time in `src/grammars/cfml.js`, never to the files on disk.
  `test/corpus.test.js` hashes both files and fails on any change - a single
  added space is enough. Updating them upstream is a deliberate procedure:
  `LICENSES/README.md`.
* **`npm` never runs on the host.** Everything routine is a script in
  `scripts/`, each a single `docker compose` invocation. Use those rather than
  retyping the command - `package.sh` and `test-update.sh` in particular carry
  flags whose absence fails silently.
* **JSDoc continuation lines start with `*` at column zero**, no aligning
  space. No formatter enforces this; Prettier is deliberately not used because
  it would rewrite exactly this.

README.md is the command reference.
