## Basic Etiquette

* When asserting facts about the code, never assume - always check against the code.
* Use fewer words, unless I ask for a more detailed explanation.
* **Never put a reference in a comment that can drift silently.** No line
  numbers, no ticket or issue or PR numbers, no "see above/below", no links to
  anything whose URL encodes a position. Anchor to something greppable instead:
  a symbol name, or a filename. The test is not "will
  this go stale" - everything does - it is "will anything notice." A renamed
  file breaks loudly and gets fixed; a stale line number just quietly lies, and
  the reader trusts it because comments in this repo are usually right.
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
