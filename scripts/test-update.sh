#!/usr/bin/env bash
#
# Regenerate the golden files after a DELIBERATE change to highlighting.
#
#   ./scripts/test-update.sh
#
# THEN READ THE DIFF. An unreviewed update blesses whatever the code currently
# does, which converts the corpus from a test into a rubber stamp -- it will
# happily record a regression as the new expected output. That is the entire
# risk of this command and the reason it is a separate script rather than a flag
# on test.sh.
#
# This is also the one place test/ is mounted READ-WRITE. Everywhere else it is
# :ro, which is why `--update` fails with EROFS against them rather than quietly
# working. That asymmetry is deliberate: regenerating goldens should be
# something you chose to do. src/ stays :ro even here -- the goldens live in
# test/, so the one writable command has no reason to reach source.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

run docker compose run --rm "$@" test-update

# Show what moved, so "read the diff" is the default rather than a good
# intention. Falls back quietly outside a git checkout.
if git rev-parse --git-dir > /dev/null 2>&1; then
	printf '\n\033[1mChanged goldens:\033[0m\n\n'
	git status --short test/__fixtures__/ || true
	printf '\nReview with:  git diff test/__fixtures__/\n'
fi
