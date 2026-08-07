#!/usr/bin/env bash
#
# Build the Lambda deployment zip into dist/function.<YYYYMMDD>.zip.
#
#   ./scripts/package.sh
#
# THE DATE IS IN THE FILENAME, NOT IN THE ZIP. That is deliberate. Two builds
# from unchanged source currently produce byte-identical zips, which means "did
# this artifact come from this source?" can be answered by rebuilding and
# comparing hashes -- a proof rather than a claim. Stamping a timestamp INSIDE
# the zip would destroy that permanently, since every build would then differ
# from every other one. The filename carries the date and the bytes stay clean.
#
# Building does not require committed code, so the date says when the build ran
# and nothing about which commit it came from. That is the whole intent: it
# distinguishes the zips on your disk, and claims nothing it cannot back up.
#
# Same-day rebuilds OVERWRITE. One artifact per day, latest wins, so dist/ does
# not fill up with 4 MB files during an afternoon of iterating.
#
# --build IS NOT OPTIONAL, which is the reason this script exists. `compose run`
# reuses the existing image by default, so without it you get a zip built from
# the PREVIOUS image -- a stale artifact, silently, with a cheerful success
# message. The layer cache means --build costs about a second when nothing has
# changed, so there is no case for leaving it off.
#
# Everything else about this step is documented at the `package` service in
# docker-compose.yaml: why it writes to dist/ rather than the repo root, why it
# is the one service that is not read-only, and why it runs with no network.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

run docker compose run --rm --build package "$@"

# The container writes a fixed name; the date is applied here, on the host. That
# keeps the image's contract stable and the naming policy in one place. `set -e`
# means a failed build has already exited above, so there is nothing to rename.
artifact="dist/function.$(date +%Y%m%d).zip"

mv dist/function.zip "$artifact"

printf '\n'
ls -lh "$artifact"
printf '\nUpload this file: \033[1m%s\033[0m\n' "$artifact"
