#!/usr/bin/env bash
#
# Stop everything and remove the containers.
#
#   ./scripts/stop.sh
#
# Nothing here holds state worth preserving -- no database, no volumes beyond
# the bind mounts, and both services run read_only with a tmpfs /tmp. So there
# is no "down destroys your data" caveat: `down` is just the counterpart to
# `up`, and the built zip is on the host either way.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

run docker compose down "$@"
