#!/usr/bin/env bash
#
# Pick up an edit to src/ or tools/.
#
#   ./scripts/restart.sh             both services
#   ./scripts/restart.sh tools       just the inspection pages
#
# WHY THIS IS NEEDED AT ALL. Both services bind-mount their source, so the files
# in the container are already current -- but Node does not reload modules, and
# the running process keeps whatever it imported at startup. Editing a file and
# refreshing the page shows you the OLD code, with no error and no clue.
#
# Fixtures are the exception: they are re-read on every request, so editing a
# .code or .html file shows up on refresh with no restart.
#
# Not using `node --watch` deliberately: file-change events do not reliably
# cross the Docker Desktop VM boundary on macOS, and a watch flag that silently
# fails to fire is worse than no watch flag.
#
# A dependency change (package.json, package-lock.json) or a Dockerfile change
# needs a rebuild instead, because node_modules is baked into the image:
#
#   ./scripts/start.sh --build
#
# WHY `up -d --force-recreate` RATHER THAN `restart`. A container's mounts, env
# and ports are fixed when it is CREATED, so anything that only restarts an
# existing container cannot pick up an edit to docker-compose.yaml. Measured,
# because the obvious alternatives are both wrong in one direction:
#
#   restart              src/ edit: yes    compose edit: NO
#   stop + start         src/ edit: yes    compose edit: NO
#   up -d                src/ edit: NO     compose edit: yes
#   up -d --force-recreate            yes                yes
#
# The third row is the trap: with the config unchanged, `up -d` decides there is
# nothing to do and leaves the process running the code it started with.
#
# This cost a confusing debugging session once already -- a bind mount was added
# for test/, `restart` reported success, and the service kept 500ing against a
# directory it could not see.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

if [ "$#" -eq 0 ]; then
	run docker compose up -d --force-recreate highlighter tools
else
	run docker compose up -d --force-recreate "$@"
fi
