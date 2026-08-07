#!/usr/bin/env bash
#
# Shared preamble. Sourced by every script here; not runnable on its own.
#
# WHY THESE SCRIPTS EXIST AT ALL
#
# They are not an abstraction over Docker Compose and must never become one.
# Each one spells out a single `docker compose` invocation, so what runs is
# readable in the file and there is nothing that can drift away from
# docker-compose.yaml. Anything genuinely interesting -- why a service is
# read-only, why one has no network, why `package` needs --build -- is
# documented at the service in docker-compose.yaml, which stays the source of
# truth. These are shortcuts, not a layer.
#
# The one that earns its keep is package.sh: `compose run` reuses the existing
# image by default, so a forgotten --build produces a zip built from the
# PREVIOUS source, silently, with a success message. That flag is the difference
# between shipping your work and shipping last week's.

set -euo pipefail

# Run from anywhere. Compose resolves relative paths (the bind mounts, the build
# context) against the file's directory, so the repo root is the only correct
# working directory -- and `cd`-ing here means these work from a subdirectory or
# an editor's run button without silently mounting the wrong tree.
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Echo the command before running it. These scripts are also documentation: the
# point is that you learn the compose invocation by watching it, and can drop
# down to it the moment you need a flag no script offers.
run() {
	printf '\n\033[2m$ %s\033[0m\n\n' "$*"
	"$@"
}
