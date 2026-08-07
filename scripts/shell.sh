#!/usr/bin/env bash
#
# A shell inside the runtime image, for poking at things.
#
#   ./scripts/shell.sh
#
# Useful for the questions that are about the IMAGE rather than the code: what
# version of starry-night is actually installed, what a grammar file contains,
# whether a scope is registered. For example:
#
#   node -p "require('@wooorm/starry-night/package.json').version"
#   node -e "import('/app/src/core/highlight.js').then(async m => {
#     const sn = await m.init(); console.log(sn.scopes().length) })"
#
# This is a throwaway container (--rm) with src/ and tools/ mounted read-only, so
# nothing you do in here can change the repo or persist. It is `run`, not `exec`,
# so it does not need the services to be up.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

run docker compose run --rm --entrypoint sh tools "$@"
