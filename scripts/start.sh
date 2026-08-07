#!/usr/bin/env bash
#
# Start the API and the inspection tools.
#
#   ./scripts/start.sh          foreground, Ctrl-C to stop
#   ./scripts/start.sh -d       detached
#
#   API    http://127.0.0.1:3000   (POST /highlight, needs the token header)
#   tools  http://127.0.0.1:3001   fixtures, and /blog to check a live post
#
# Both are bound to loopback. Nothing on your LAN can reach either one.
#
# `tools` is deliberately NOT profile-gated: whenever the API is up it should
# be up too, so a plain `up` starts both. The one-shot tools (`package`, `test`,
# `test-update`) are gated and stay out of the way.
#
# Extra arguments pass through, so `./scripts/start.sh --build` works after a
# package.json or Dockerfile change.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

run docker compose up "$@"
