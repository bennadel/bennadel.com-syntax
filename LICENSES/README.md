# Third-party code vendored into this repository

Everything the service depends on arrives one of two ways, and only the second
kind needs anything recorded here.

**Via npm** — `@wooorm/starry-night` and `hast-util-to-html`, pinned in
`package-lock.json` with a per-package `sha512` integrity hash. Each package
carries its own license file, and because the deployment artifact ships
`node_modules` verbatim rather than bundling it, those license files travel with
the code automatically. Nothing to do. (Worth knowing that starry-night itself
vendors ~700 grammars from many upstreams and documents them in its own `notice`
file — `node_modules/@wooorm/starry-night/notice`, about 1.6 MB. That file is the
model this directory imitates at a much smaller scale, and it is already inside
`function.zip` along with 35 other license files.)

**Why there is no extracted license bundle here, unlike an Angular build.**
`ng build` writes a `3rdpartylicenses.txt` into its output, and it has to:
webpack/esbuild concatenate dependencies into a few files and destroy the
`node_modules` tree, so every upstream license file is lost unless the bundler
re-attaches it. We never bundle — decision recorded in the gotchas, for the
unrelated reason that a bundler mishandles starry-night's `#get-oniguruma`
imports map — so nothing is ever stripped and there is nothing to reconstruct.
Copying those licenses to this directory would duplicate what is already in the
artifact, and the copy would go stale on the next dependency bump.

The rule this directory follows: **record what no tool tracks.** npm-installed
code is tracked by the lockfile and carries its own notices. Files copied in by
hand are tracked by nothing, which is why they are listed below.

**Copied into the tree by hand** — the two CFML grammars below. These are the
ones an automated tool will miss, because they are files rather than packages.
That is the entire reason this directory exists.

## cfmleditor CFML grammars

| | |
|---|---|
| Files | `src/grammars/cfml.tmLanguage.json`, `src/grammars/cfml-cfs.tmLanguage.json` |
| Upstream | <https://github.com/cfmleditor/cfmleditor>, `syntaxes/` on `master` |
| Commit | `8af4a78ebc7096224d7d3ec080fe7672badca1d6` (2025-02-18) |
| License | MIT — [`cfmleditor-MIT.txt`](cfmleditor-MIT.txt) |
| SPDX | `MIT` |
| Copyright | 2017 KamasamaK, inherited from the vscode-cfml project cfmleditor forked |

```
61e7d83cc25ab53816ea427175acb2e8e5ce96f78cb098a3fe2e5fbf3b88de42  cfml.tmLanguage.json
e3681da75d487b39d5f1ba0e05d28cbbabbc869189582f4828c6c645d9d6207e  cfml-cfs.tmLanguage.json
```

**Why they are vendored.** Linguist — and therefore starry-night, and therefore
GitHub — renders CFML with `SublimeText/ColdFusion`, whose cfscript file was last
touched 2013-06-25. CFML is roughly half the code in this archive. cfmleditor is
the maintained grammar, and that is the whole argument: not that it is better
today, but that it will still be right in five years. What the swap gained and
what it gave up is recorded in the header of `src/grammars/cfml.js`.

**They are byte-identical to upstream and must stay that way.** The two patches
this project needs are applied to the parsed JSON in memory at load time, by
`src/grammars/cfml.js`, never to the files on disk. Hand-editing a 600 KB
generated file would make every future upstream update a conflict against
something unreadable.

That is not an honour-system claim: `test/corpus.test.js` hashes both files on
every run and fails if either has changed. If you deliberately update them,
that test tells you the recorded hashes are stale, and the fix is to update the
hashes here, in `src/grammars/cfml.js`, and in the test — in the same commit as
the new files, having read what changed.

**To update:**

1. Re-download both files from a chosen upstream commit
2. `shasum -a 256 src/grammars/*.tmLanguage.json`
3. Update the commit, date and hashes here and in `src/grammars/cfml.js`
4. Update the `SOURCES` hashes in `test/corpus.test.js`
5. `./scripts/test.sh` — the patch assertions will tell you whether upstream has
   started handling `include "…"` or `?.` itself, in which case the corresponding
   patch should be deleted rather than carried forward
6. `./scripts/test-update.sh`, then **read the golden diff**
7. Re-check [`cfmleditor-MIT.txt`](cfmleditor-MIT.txt) against upstream's LICENSE
   at the new commit, in case the copyright line changed

## Scope of this directory

These notices are here because this repository is where the vendored source
lives. They are deliberately **not** included in the deployment zip: the
artifact is deployed to infrastructure this project controls and is not conveyed
to anyone, so MIT's attribution requirement is not triggered by the deploy.
`.dockerignore` denies everything by default, so this directory stays out of the
build context without needing a rule of its own.

**That changes if the artifact is ever handed to a third party.** If the zip goes
anywhere but our own Lambda, the notice has to travel inside it. Publishing this
repository does not create that problem — the notices are already here, which is
the point of keeping them at the root rather than beside the code.
