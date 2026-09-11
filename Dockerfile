# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Stage 1: dependencies
#
# Pinned by digest, not tag. Tags are mutable -- node:24-alpine points at
# different bytes month to month -- and this matters more than usual here
# because the golden corpus verifies THE IMAGE. If the image isn't
# reproducible, that verification means nothing.
#
# Digest resolved 2026-08-09. To move to a newer base deliberately:
#
#   docker buildx imagetools inspect node:24-alpine \
#     --format '{{println .Manifest.Digest}}'
#
# This is a multi-arch manifest list, so it resolves correctly on both your
# arm64 Mac and an amd64 deployment host.
# ---------------------------------------------------------------------------
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS deps

WORKDIR /app

# Manifests only, so this layer caches independently of source edits. Changing
# src/ won't trigger a reinstall.
COPY package.json package-lock.json ./

# --ignore-scripts blocks pre/post-install lifecycle hooks, which are the main
# supply-chain execution vector. Safe here specifically because the dependency
# tree is pure JS/WASM -- vscode-textmate and vscode-oniguruma ship a prebuilt
# .wasm, with no native compilation step that would need a hook to run.
#
# --omit=dev keeps test and lint tooling out of the runtime image.
RUN npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# Stage 2: packaging  (built only on demand -- see the `package` service in
# docker-compose.yaml)
#
# Produces the Lambda deployment zip.
#
# `FROM deps` is the entire point: npm ci becomes a CACHED LAYER. The equivalent
# `docker run ... npm ci && zip` one-liner reinstalls every dependency on
# every invocation; here npm only re-runs when package-lock.json actually
# changes, so rebuilding the zip after a source edit takes seconds.
#
# A separate stage, not a step in the runtime stage, so `zip` and `unzip` never
# land in the shipped image. Nothing below stage 3 is built unless a target asks
# for it, and the runtime stage stays last so a plain `docker build` still
# produces the service image.
# ---------------------------------------------------------------------------
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS package

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./

RUN apk add --no-cache zip unzip

# Only src is new relative to deps, so editing a source file invalidates one
# small layer rather than the dependency install.
COPY src ./src

# The two members whose absence produces a deploy that SUCCEEDS and a function
# that fails every invocation forever: the WASM binary starry-night resolves at
# runtime, and the handler itself. Checking them here means the failure happens
# at package time, on your machine, with a clear message.
RUN printf '%s\n' \
	'#!/bin/sh' \
	'set -eu' \
	'rm -f /out/function.zip' \
	'zip -qr /out/function.zip node_modules src package.json' \
	'for member in \' \
	'  node_modules/vscode-oniguruma/release/onig.wasm \' \
	'  src/adapters/lambda.js \' \
	'  package.json' \
	'do' \
	'  unzip -l /out/function.zip | grep -q "$member" \' \
	'    || { echo "FAIL: $member is missing from the zip -- do not upload"; exit 1; }' \
	'done' \
	'ls -lh /out/function.zip' \
	'echo "OK. Upload to Lambda. Handler is src/adapters/lambda.handler"' \
	> /usr/local/bin/package-lambda \
	&& chmod +x /usr/local/bin/package-lambda

CMD ["package-lambda"]

# ---------------------------------------------------------------------------
# Stage 3: runtime
#
# Separate stage so the npm cache, lockfile, and any dev dependencies resolved
# during install never reach the shipped image.
# ---------------------------------------------------------------------------
FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS runtime

ENV NODE_ENV=production

WORKDIR /app

# Files owned by root, process runs as `node` (uid 1000, ships with the image).
# The running service therefore cannot modify its own code or dependencies --
# a compromised request handler can't persist anything.
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json ./
COPY --chown=root:root src ./src

USER node

EXPOSE 3000

# Hits the real HTTP path rather than just checking the port, and do not
# simplify it to a port check. A wedged match blocks the event loop, so the
# kernel goes on accepting connections on 3000 while nothing ever answers --
# a port probe passes in exactly the situation that matters. `fetch` is global
# in Node 18+, so this needs no extra dependency and no shell.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:3000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "src/adapters/server.js"]
