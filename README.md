
# Code Syntax Highlighter For BenNadel.com

by [Ben Nadel][ben-nadel]

On my blogging platform, the fenced code-block syntax highlighting has historically been provided by GitHub (via publish-time Gist creation). And it's always bothered me that this is the one remaining _core_ part of the blogging workflow that I feel like I don't own. As such, with the aide of **Claude Code**, I've finally set out to make my own self-hosted syntax highlighting service.

The API takes the raw code as the POST body (Content-Type is ignored) with the language as an optional `?language=` query parameter, and returns escaped HTML with `pl-*` token classes — the same vocabulary GitHub's Markdown API emits, so existing CSS works unchanged. The response body is the HTML fragment itself, with metadata in the `X-Highlighted` and `X-Scope` headers; errors return JSON `{error}`. Output is identical to GitHub for languages where it ships the same TextMate grammar and diverges where GitHub ships a different one.

The API runs locally in Docker and is deployed to AWS Lambda as a zip (Click-Ops for the win - baby-stepping my way to a working solution).

## Quick Start

```bash
# API on 127.0.0.1:3000, tools on :3001, Ctrl-C stops it
./scripts/start.sh
```

Then in another terminal:

```bash
curl -si -X POST 'http://127.0.0.1:3000/highlight?language=cfml' \
  -H 'x-highlight-token: dev-local-only' \
  --data-binary '<cfscript>x = 1;</cfscript>'
```

Use `--data-binary` when posting from a file (`--data-binary @file.cfm`) — plain `-d` strips newlines. The `-i` shows the `X-Highlighted` and `X-Scope` response headers alongside the HTML body.

## Repository Layout

The boundary that carries weight here is **what ships versus what does not**, and it is mechanical rather than a convention: `.dockerignore` denies `*` and allows back only `src/` and the two manifests. Nothing else is excluded by a rule — it is excluded by not being `src/`.

| path | what it is | ships |
|---|---|---|
| `src/core/` | `highlight.js`, the pure function over code plus a language flag; `config.js`, every env var parsed and validated once; `api.js`, transport-neutral auth, routing and response serialization | yes |
| `src/adapters/` | `server.js` for `node:http`, `lambda.js` for a Function URL. Transport only — no logic that both would need | yes |
| `src/grammars/` | The two cfmleditor CFML grammars, vendored byte-identical, plus `cfml.js` which loads and patches them in memory | yes |
| `test/` | `corpus.test.js` (golden output), `contract.test.js` (adapter parity), `__fixtures__/` | no |
| `tools/` | Local inspection pages on `:3001` — `/` renders the corpus, `/blog` renders a live post. Never packaged | no |
| `scripts/` | One `docker compose` wrapper per routine task, plus `check-upstream.sh` | no |
| `dist/` | Build output, `function.<YYYYMMDD>.zip`. Ignores itself via `dist/.gitignore` | n/a |
| `LICENSES/` | Provenance and notices for the hand-vendored grammars, and the procedure for updating them | no |
| `Dockerfile`, `docker-compose.yaml` | Both halves of the container definition, deliberately at the same level | n/a |
| `README.md` | This command reference | no |

Dependencies inside `src/` point one way: adapters import core, core imports nothing from adapters. A `../adapters/` import under `core/` means the layering has been broken, and the import line itself says so.

Three directories are the *inputs* (`src/`, `test/`, `tools/`); `dist/` is the only *output*. `src/grammars/` sits outside the core/adapters split on purpose — it is third-party code this repo happens to carry, tracked in [`LICENSES/README.md`](LICENSES/README.md), not our logic.

## Running It Locally

Everything routine has a script in `scripts/`. Each one is a
`docker compose` invocation with the reasoning in its header, and each echoes
the command before running it — so they are also how you learn the underlying
invocation, and you can drop to `docker compose` directly whenever you need a
flag no script offers.

| command | what it does |
|---|---|
| `./scripts/start.sh` | Start the API and the inspection tools in the foreground. Picks up whatever is in `src/` — no rebuild needed. Ctrl-C stops it. Takes `-d` to detach, or `--build`. |
| `./scripts/restart.sh` | Pick up a `src/`, `tools/` **or `docker-compose.yaml`** edit. Node does not hot-reload, so this is required even though the source is mounted. Takes a service name. |
| `./scripts/stop.sh` | Stop and remove the containers. Ctrl-C only stops them. |
| `./scripts/test.sh` | Run both test suites. See [Tests](#tests). |
| `./scripts/test-update.sh` | Regenerate the golden files, then show you what changed. |
| `./scripts/package.sh` | Build `dist/function.<YYYYMMDD>.zip`. See [Building the deployment artifact](#building-the-deployment-artifact). |
| `./scripts/check-upstream.sh` | Have starry-night or the cfmleditor grammars moved? Reports only; changes nothing. Exits 1 when an update exists, so it is cron-able. |
| `./scripts/logs.sh` | Follow the logs. Takes a service name. |
| `./scripts/shell.sh` | A throwaway shell inside the runtime image. |

They run from anywhere in the repo — each one `cd`s to the root first, because
Compose resolves bind mounts and the build context relative to the file.

Bound to `127.0.0.1` only — nothing on your LAN can reach either port.

Running in the foreground is the recommended default here: the `MAX_LINE_LENGTH` guard logs a line every time it refuses a block, and that is exactly the sort of thing you want to see as it happens rather than discover later.

**`src/` is bind-mounted**, so the edit loop is `./scripts/restart.sh` — no image rebuild. `node_modules` stays baked into the image, which is why a dependency change still needs `./scripts/start.sh --build`. Note this does **not** apply to the deployment zip: the `package` service builds from the Dockerfile, not the mount, which is exactly why `--build` is mandatory there and why `package.sh` always passes it.

## Tests

```bash
./scripts/test.sh            # both suites; exits non-zero on failure
./scripts/test-update.sh     # regenerate golden files -- read the diff
```

Two suites, deliberately separate because they answer different questions.

| suite | question it answers |
|---|---|
| `test/corpus.test.js` | Does `highlight()` still produce the exact bytes it produced when a human last approved them? |
| `test/contract.test.js` | Do `src/adapters/server.js` and `src/adapters/lambda.js` return **identical** status, headers, and body for the same request? |

**The corpus** targets `src/core/highlight.js` directly rather than a packaging artifact, so it needs no port or container and separates "did the grammar output change?" from "did the transport change?". Each case is a pair of files in `test/__fixtures__/` — `<slug>.<language>.code` holding hand-written input, and a generated `.html` sibling holding the expected output. The language comes from the filename, so adding a case is one file plus a regenerate. It also asserts the things golden files cannot express: `normalize()`'s CRLF handling, `longestLine()`, the `MAX_LINE_LENGTH` boundary from both sides, and that escaping produces GitHub's exact entity form on both the highlighted and unhighlighted paths.

**The contract test** drives both adapters through every status code and diffs them against each other. That second part is the point — it turns "the contract is identical against both adapters" from a claim maintained by discipline into a checked property. Two bugs during development had to be fixed twice in two files; this is what catches the third.

Both live in `test/` rather than beside the code they exercise. The deployment zip is built by copying `src/` wholesale, so **anything under `src/` ships** — keeping tests outside it means `.dockerignore`'s `*` rule excludes them without naming them. Naming them instead would cover only the shapes listed, so the first file that didn't match the pattern would ship. Test runs use `network_mode: none`, so a green run also proves the grammars compiled from the bundled WASM rather than quietly fetching `onig.wasm` over the network.

### Regenerating Goldens

`test-update` is the only place `test/` is mounted read-write; everywhere else it is `:ro`, so `--update` fails with `EROFS` rather than quietly succeeding. `src/` stays `:ro` even there — the goldens live in `test/`, so the one writable command has no reason to reach source. That asymmetry is deliberate — regenerating is an act you opt into, not something a test run can do to itself.

**Always read the resulting diff.** An unreviewed `--update` blesses whatever the code currently does, which converts the corpus from a test into a rubber stamp. A grammar bump legitimately changes these files; a regression looks exactly the same in `git status`.

## Building the Deployment Artifact

```bash
./scripts/package.sh
```

Writes `./dist/function.<YYYYMMDD>.zip` (~4.0 MB), then verifies its own output: `onig.wasm`, `src/adapters/lambda.js` and `package.json` must all be present or it exits non-zero. Their absence would otherwise produce a deploy that *succeeds* and a function that fails every invocation forever.

**The date is in the filename, not in the zip.** Two builds from unchanged source produce byte-identical archives, so "did this artifact come from this source?" is answerable by rebuilding and comparing hashes — a proof rather than a claim. A timestamp inside the zip would destroy that. The filename distinguishes the builds on your disk and claims nothing more; since packaging does not require committed code, the date says when the build ran and nothing about which commit it came from. Same-day rebuilds overwrite.

- **`--build` is required, not optional**, and the script always passes it. `compose run` reuses the existing image by default, so omitting it silently hands you a zip built from the *previous* image after a source edit — the one way this setup can hurt you, and the reason `package.sh` exists rather than being a line you retype. The layer cache makes `--build` cost about a second.
- **Profile-gated**, so plain `./scripts/start.sh` never starts it. Naming the service explicitly auto-enables its profile, so no `--profile` flag is needed.
- `npm ci` is a cached Docker layer, so this is ~1s warm rather than a full dependency reinstall.

Upload the zip in the Lambda console. **Handler is `src/adapters/lambda.handler`** — not the console default. Step-by-step walkthrough under [Deployment steps](#deployment-steps) below.

## Endpoints

| | |
|---|---|
| `POST /highlight?language=<flag>` | The service. Requires `x-highlight-token`. The request body is the raw code text; its Content-Type is ignored. `language` is optional. A 200 body is the highlighted HTML fragment (`text/html`), with `X-Highlighted: true\|false` and `X-Scope` (the TextMate scope of the grammar that ran, e.g. `embedding.cfml` — a debugging aid, not a language name; always present, empty when nothing resolved) as headers. Errors are JSON `{error}`. |
| `GET /health` | `{"ok":true}`. Unauthenticated. |

`X-Highlighted: false` is **not an error** — it means the language was unrecognized or a line exceeded `MAX_LINE_LENGTH`, and the body is escaped plain text. Still HTTP 200. Callers never branch on it — one degradation path, never a third case to special-case.

## Configuration

| variable | default | |
|---|---|---|
| `PORT` | `3000` | Read by both `src/adapters/server.js` and Lambda. |
| `HIGHLIGHT_TOKEN` | **required** | Shared secret. Both adapters refuse to start without it. `dev-local-only` in Compose. |
| `MAX_BYTES` | `262144` | Payload cap (256 KB). |
| `MAX_LINE_LENGTH` | `2000` | ReDoS guard. Any block with a longer line is returned as plain text. |

### Generating a token

```bash
openssl rand -hex 32
```

256 bits from the OS entropy source. Do not hand-write one, and do not have an assistant print one into a chat transcript — model-generated hex looks identical to the real thing but carries no entropy guarantee, and anything pasted into a transcript is stored on disk and sent to a third-party API. Run the command yourself and paste the result straight into wherever it is going.

`HIGHLIGHT_TOKEN` is **required**. `src/adapters/server.js` exits 1 without it and `src/adapters/lambda.js` throws during INIT. This is deliberate, and **do not add a permissive fallback for an unset token**: treating *unset* as *allow everything* is a fine default on a laptop and a wide-open endpoint behind a public Function URL, and the process cannot tell those apart. Failing loudly is the only behaviour that is safe in both places.

Consequence worth knowing: **set the variable before uploading a new zip.** In the other order the function fails INIT and every request errors until you fix it.

Local development needs no action — `docker-compose.yaml` supplies `dev-local-only`.

## Maintenance

```bash
# Regenerate the lockfile without running npm on the host.
docker run --rm -v "$PWD":/app -w /app node:24-alpine \
  npm install --package-lock-only --ignore-scripts

# Resolve a new base-image digest, after deciding to move to a newer one.
docker buildx imagetools inspect node:24-alpine --format '{{println .Manifest.Digest}}'
```

**`npm` never runs on the host** — not for installs, not for the lockfile, not for packaging. That plus `--ignore-scripts` is the supply-chain posture, and the zip build is containerized for exactly this reason.

## Documentation

| file | |
|---|---|
| [LICENSES/](LICENSES/) | Third-party notices and provenance for code vendored by hand — currently the two cfmleditor CFML grammars. npm dependencies need nothing here; they carry their own licenses and ship them with `node_modules`. |

Every Linguist grammar is registered, plus 2 vendored CFML grammars. Individual fence tags are corrected by the `flagOverrides` map in `src/core/highlight.js`, which is commented with what each override repairs.

## Local Grammar Changes

Where this service renders differently from the published grammars, the difference is a deliberate preference. Each line states what a reader of the rendered page sees. How it is done is in the source (`src/grammars/cfml.js`, `src/grammars/stock.js`, `src/core/highlight.js`); this list stays current with it.

**Rendering**

- **CFML**: `include "path";` colors as a tag statement, not plain text.
- **CFML**: the `?.` safe-navigation operator colors as an operator.
- **CFML**: Lucee tag islands inside cfscript highlight as tags anywhere in the script, including function bodies and script-based components.
- **CFML**: a bare `&` in URLs and attribute values is not flagged as an error.
- **CFML**: digits in custom tag names (`<cf_h1>`, `<html:h1>`) are not flagged as errors.
- **CFML**: call expressions in function metadata (`cachedWithin = createTimeSpan(...)`) highlight as expressions, not errors.
- **CFML**: `<`, `<=` and `<>` in cfquery SQL bodies are not flagged as errors.
- **CFML**: common column names (`name`, `type`, `value`, `status`, `date`, `data`) are not colored as SQL keywords inside cfquery bodies.
- **CFML**: a block written with tags highlights as tags even when the fence says script (`cfc`, `cfs`, `cfscript`).
- **CFML, HTML**: `--` inside an HTML comment (hyphen-divider comments) is not flagged as an error.
- **CFML, HTML**: the `<!DOCTYPE` keyword is highlighted.
- **CFML, JavaScript, TypeScript**: every chained method call renders in one color, whether or not the name collides with a DOM or standard-library method.
- **CFML, JavaScript, TypeScript**: object-literal keys color as constants.
- **CFML, JavaScript, TypeScript**: `console` colors as a global like `document` and `window`, and `console.log(` colors like any other method call rather than as a built-in.
- **CSS**: nested rules highlight as rules: the `&` nesting selector colors like an element name, a nested selector colors as a selector, and the declarations inside a nested block color as declarations rather than plain text.
- **CSS**: every feature in an `@media` header colors like a property name and its value like a property value, including features the grammar predates (`prefers-reduced-motion`, `prefers-color-scheme`, `pointer`).
- **CSS**: an author-defined name in a declaration value (`animation-name: modal-enter`, a grid area, an unlisted font) colors like a keyword value instead of plain text.
- **JavaScript**: regex literals highlight instead of parsing as division.
- **TypeScript**: template strings in `@Component` metadata parse as HTML.
- **TypeScript**: a property name renders in one color whether declared, accessed via `this.`, or used as a literal key.
- **SQL**: `EXPLAIN`, `EXPLAIN ANALYZE`, `WITH` and `WITH RECURSIVE` color as keywords.

**Fence tags**

- `cf`, `cfm`, `cfml`, `coldfusion` highlight as tag-based CFML; `cfs`, `cfscript`, `cfc`, `coldfusion-cfc` as script-based CFML. All use the cfmleditor grammars, not Linguist's.
- `dockerignore` highlights as gitignore syntax.
- `ndjson` highlights as JSON.
- `conf` highlights as nginx config, not INI.
- `txt` renders as plain text with no highlighting.

## Deployment steps

Target is AWS Lambda: zip package, uploaded through the console. No container registry, no AWS credentials on this machine, no IAM to author.

Steps below are console clicks unless shown as a command. **These have been executed** — the function is live, and the health check, authenticated highlighting, and the 401 path were all verified against the real Function URL.

### One time — create the function

- **Lambda → Create function → Author from scratch.** Runtime **Node.js 24.x**, architecture **arm64** (20% cheaper; the artifact is architecture-neutral, so this is purely a pricing choice).
- **Permissions → "Create a new role with basic Lambda permissions."** This is the entire IAM story. It grants CloudWatch Logs and nothing else, and you never need to open it again.
- **Runtime settings → Handler → `src/adapters/lambda.handler`.** Not the `index.handler` default. A mismatch fails at invoke time with `Cannot find module 'index'`, which reads like a packaging problem rather than a configuration one.
- **General configuration → Memory `1769` MB, Timeout `10` seconds.** 1769 MB is exactly one vCPU; because Lambda bills memory × duration, anything below it costs the same and runs slower, and anything above it costs more for no gain on single-threaded work. The 10 s timeout bounds a pathological block to a fraction of a cent.
- **Environment variables → `HIGHLIGHT_TOKEN`.** Required — the function fails INIT without it. See [Generating a token](#generating-a-token). Optionally `MAX_BYTES` and `MAX_LINE_LENGTH`; both have code defaults.
- **Configuration → Function URL → Create → Auth type `NONE`.** Record the URL — it goes in the ColdFusion config as a value, never hard-coded.
- **Monitoring → Log group → Retention → 30 days.** The default is never-expire, which is a slow leak rather than a spike, but there is no reason to keep publish-time logs for years.

### One time — abuse and cost controls

**Read this before exposing the URL.** `AuthType: NONE` means *anyone who has the URL can invoke the function.* The `x-highlight-token` check happens **inside** your code, so a request with no token still costs you an invocation and a few milliseconds of billed duration before it is rejected with a 401. Auth prevents unauthorized *highlighting*; it does not prevent unauthorized *invocation*.

- **Configuration → Concurrency → Reserved concurrency = `2`.** This is the single most important control. It caps concurrent executions at 2 and, because a Function URL's request-rate ceiling is 10× reserved concurrency, caps throughput at ~20 req/s. Everything beyond that is rejected with a 429 *before your code runs*, so it costs no duration.
- **Raise it temporarily for the backfill, then put it back.** The archive backfill wants ~4 caller threads at ~20 req/s each; at reserved concurrency 2 it will throttle itself. Set it to `10` for the run and back to `2` afterwards. This is the one place the security control and normal operations collide, and it is easy to misdiagnose as the service being broken.
- **Billing → Budgets → Create budget → Zero spend budget**, or a $1 monthly cost budget with an alert at 100%. **AWS has no hard spend cap** — this alerts you, it does not stop anything. If you want a budget that *acts*, AWS Budgets Actions can apply a restrictive IAM policy when a threshold is crossed, but it needs its own IAM role and is more machinery than this workload justifies.
- **CloudWatch → Alarms → Create alarm on the function's `Invocations` metric**, e.g. `> 1000` in 5 minutes, notifying an SNS topic with your email. The free tier includes 10 alarms. At ~3 publishes a day, any alarm at all means something is wrong.

**What a sustained attack actually costs**, at reserved concurrency 2: an attacker without the token is rejected in a few milliseconds, so duration is negligible — roughly $0.64/month over the free tier. The request charge dominates: ~20 req/s for a full month is ~52M requests, about **$10** after the 1M free. Lower the reserved concurrency and that figure falls proportionally.

That number is the pessimistic bound. It assumes *throttled* requests are billed, and **AWS's pricing page does not say either way** — it defines billable requests as those "served" and is silent on throttling. The common understanding is that a 429 costs nothing because the code never runs, which would make the real figure much lower. Treat $10/month as the ceiling, not the estimate, and confirm from an actual bill if it ever matters.

### Every deploy

- **Build the artifact.** `./scripts/package.sh` → `dist/function.<YYYYMMDD>.zip`. The `--build` is mandatory; without it you get a zip from the previous image. The build self-checks that `onig.wasm`, `src/adapters/lambda.js` and `package.json` are present and exits non-zero if not.
- **Code → Upload from → .zip file** → the dated zip the script just named for you → Save.
- **Wait for the update to finish** before testing. The console shows it; a smoke test that races the update produces confusing failures.
- **Smoke test all three paths** — success, auth rejection, and the fallback:

```bash
URL=https://<id>.lambda-url.us-east-1.on.aws

curl -s "$URL/health"                                    # {"ok":true}

curl -si -X POST "$URL/highlight?language=cfml" \
  -H "x-highlight-token: $HIGHLIGHT_TOKEN" \
  --data-binary '<cfscript>x = 1;</cfscript>'             # x-highlighted: true

curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/highlight" \
  -d 'x'                                                  # 401
```

- **Read the `REPORT` line in CloudWatch Logs** on the first deploy. Its `Init Duration` replaces the largest estimate in the design docs, where every latency figure is a Mac measurement multiplied by an assumed 2× for Graviton.

### Emergency stop

- **Configuration → Concurrency → Reserved concurrency = `0`.** Every invocation is rejected with a 429 immediately. No redeploy, no delete, and it is reversible in one edit. This is the kill switch if the token leaks or something starts hammering the URL.
- **Then rotate `HIGHLIGHT_TOKEN`** in the environment variables and update the ColdFusion config. Note that Lambda environment variables are *not secret* — anyone with `lambda:GetFunctionConfiguration` can read the token, and it is visible in the console. That is an accepted trade for a single-owner account; it is also why the token should be rotatable in one edit rather than baked anywhere.

### Security Notes

- **The Function URL is public and should be treated as such.** It is a long random hostname, not a secret. Do not rely on it being unguessable, and never put it in client-side code — this is a server-to-server endpoint called by ColdFusion.
- **IAM auth (`AWS_IAM`) was deliberately rejected.** It would force ColdFusion to SigV4-sign every request, which means AWS credentials on the blog host — strictly worse than one rotatable shared secret, and it recreates the credential-management problem this service was designed not to have.
- **Egress is not blocked**, deliberately. Blocking it is free on Lambda via a VPC with no route out, and was declined because it defends a window `npm ci --ignore-scripts` already closes, introduces an undocumented question about whether logs still escape, and adds a 14-day idle timer that *fails* the next request. The residual risk is procedural: **never bundle the deployment artifact.** Bundling can silently switch the WASM loader to fetching from a third-party CDN at every cold start.
- **The `MAX_LINE_LENGTH` guard is a security control, not just a performance one.** It is what stops a pathological block from burning the full 10-second timeout. Do not raise it in production without a reason.


[ben-nadel]: https://www.bennadel.com/
