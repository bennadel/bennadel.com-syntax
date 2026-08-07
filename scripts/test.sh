#!/usr/bin/env bash
#
# Run both suites: the golden corpus and the HTTP contract.
#
#   ./scripts/test.sh
#
# No --build, deliberately. This mounts src/ live and node_modules is already in
# the image, so a source edit is picked up without a rebuild. Add --build only
# after changing package.json or the Dockerfile:
#
#   ./scripts/test.sh --build
#
# Extra arguments are passed through to `compose run`, which is what makes that
# work.
#
# The suite runs with no network at all (`network_mode: none`). That is worth
# knowing when a test fails oddly: a green run proves the grammars compiled from
# the bundled WASM rather than quietly fetching onig.wasm from esm.sh.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

run docker compose run --rm "$@" test
