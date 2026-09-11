#!/usr/bin/env bash
#
# Are the two upstream sources we track still where we left them?
#
#   ./scripts/check-upstream.sh
#
#   exit 0    everything current
#   exit 1    an update is available -- not an error, a finding
#   exit 2    the check itself failed (network, parse, missing tool)
#
# WHAT THIS DOES AND DELIBERATELY DOES NOT DO. It compares two numbers and
# prints the result. It downloads nothing, changes nothing, and decides nothing.
# Detection is fully deterministic and belongs in a script; deciding whether an
# upstream change is worth taking is judgement, and that work is described in
# LICENSES/README.md rather than automated here.
#
# That split is the point. This is cheap enough to run on a schedule and costs
# nothing when the answer is "no", which -- given cfmleditor's syntaxes/ went
# untouched for the eighteen months before this was written -- is the answer
# almost every time.
#
# CURRENT VALUES ARE READ FROM THE REPO, never hardcoded here. The starry-night
# version comes from package-lock.json and the cfmleditor commit from the header
# of src/grammars/cfml.js, so this script cannot quietly disagree with what is
# actually vendored. If either lookup stops working, that is a real failure and
# it exits 2 rather than guessing.
#
# THE ONLY SCRIPT HERE THAT USES THE NETWORK FROM THE HOST. Everything else in
# scripts/ is a `docker compose` wrapper. Two read-only GETs, to the npm registry
# and the GitHub API. The GitHub call is unauthenticated, which is rate-limited
# to 60 requests per hour per IP -- ample for a check you run occasionally, and
# the reason this is not wired into the test suite.

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

command -v jq > /dev/null 2>&1 || {
	printf 'This script needs jq:  brew install jq\n' >&2
	exit 2
}

# --- what we have now, read out of the repo ---------------------------------

# `|| true` on both: _lib.sh sets `pipefail`, so a grep that matches nothing
# would otherwise take the whole script down via `set -e` -- silently, and with
# exit 1, which this script defines as "an update is available". Failing to READ
# the pin would then report as a finding about upstream. Let the emptiness
# checks below do the reporting instead.
have_sn=$(jq -r '.packages["node_modules/@wooorm/starry-night"].version // empty' package-lock.json || true)
have_cfml=$(grep -oE '\b[0-9a-f]{40}\b' src/grammars/cfml.js | head -1 || true)

[ -n "$have_sn" ] || { printf 'Could not read the starry-night version from package-lock.json\n' >&2; exit 2; }
[ -n "$have_cfml" ] || { printf 'Could not read the cfmleditor commit from src/grammars/cfml.js\n' >&2; exit 2; }

# --- what upstream has ------------------------------------------------------

# A failed fetch must never look like "up to date" -- that is the one wrong
# answer this script could give, because it would read as reassurance.
fetch() {
	curl -sS --fail --max-time 20 "$1" 2>&1
}

printf '\n\033[1mUpstream check\033[0m\n\n'

updates=0

if ! sn_json=$(fetch 'https://registry.npmjs.org/@wooorm/starry-night/latest'); then
	printf '  starry-night   COULD NOT REACH the npm registry\n    %s\n' "$sn_json" >&2
	exit 2
fi

want_sn=$(printf '%s' "$sn_json" | jq -r '.version // empty')
[ -n "$want_sn" ] || { printf '  starry-night   unexpected registry response\n' >&2; exit 2; }

if [ "$have_sn" = "$want_sn" ]; then
	printf '  starry-night   %-14s current\n' "$have_sn"
else
	printf '  starry-night   %-14s \033[1m-> %s\033[0m\n' "$have_sn" "$want_sn"
	updates=1
fi

# Only commits touching syntaxes/ matter. cfmleditor is a whole VS Code
# extension; we vendor two files out of it, and its release cadence is not our
# concern.
if ! cfml_json=$(fetch 'https://api.github.com/repos/cfmleditor/cfmleditor/commits?path=syntaxes&per_page=1'); then
	printf '  cfmleditor     COULD NOT REACH the GitHub API\n    %s\n' "$cfml_json" >&2
	exit 2
fi

want_cfml=$(printf '%s' "$cfml_json" | jq -r '.[0].sha // empty')
want_date=$(printf '%s' "$cfml_json" | jq -r '.[0].commit.committer.date // empty' | cut -c1-10)
want_subject=$(printf '%s' "$cfml_json" | jq -r '.[0].commit.message // empty' | head -1)

[ -n "$want_cfml" ] || { printf '  cfmleditor     unexpected GitHub response\n' >&2; exit 2; }

if [ "$have_cfml" = "$want_cfml" ]; then
	printf '  cfmleditor     %-14s current\n' "${have_cfml:0:7}"
else
	printf '  cfmleditor     %-14s \033[1m-> %s\033[0m  (%s)\n' \
		"${have_cfml:0:7}" "${want_cfml:0:7}" "$want_date"
	printf '                 %s\n' "$want_subject"
	updates=1
fi

printf '\n'

# --- what to do about it ----------------------------------------------------

if [ "$updates" -eq 0 ]; then
	printf 'Everything is current.\n\n'
	exit 0
fi

cat <<'NEXT'
An update is available. Taking it is a judgement call, not a mechanical one.

Most of the evaluation is already automated, so start by letting it run:

  1. Swap the new version or files in
  2. ./scripts/test.sh

The suite is built to tell you what changed and what it means:

  - The patch anchors in src/grammars/patches/ assert their own preconditions.
    A failure there means upstream restructured the region we patch -- or, for
    safe-navigation, that upstream now handles `?.` itself and our patch should
    be DELETED rather than carried forward.
  - The corpus hashes both vendored files, so it will tell you the recorded
    SHA-256s are stale. Those live in three places on purpose.
  - ./scripts/test-update.sh then shows the output delta, per fixture. That
    diff is the actual decision: is this better, or is it a regression?

Nobody reads the 600 KB JSON diff. Read the goldens.

Full procedure, including the step that is easy to forget (re-check the
upstream LICENSE at the new commit, in case the copyright line moved):

  LICENSES/README.md

NEXT

exit 1
