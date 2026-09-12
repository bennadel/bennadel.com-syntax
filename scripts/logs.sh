#!/usr/bin/env bash
#
# Follow the logs.
#
#   ./scripts/logs.sh                both services
#   ./scripts/logs.sh highlighter    just the API
#
# Worth watching for the one thing the service says out loud rather than
# failing on: `highlight: refused <scope>` when a block exceeds MAX_LINE_LENGTH.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

run docker compose logs --follow --tail 50 "$@"
