#!/usr/bin/env bash
set -uo pipefail

# Review-thread resolve gate (PreToolUse, Bash). Denies a `gh api` GraphQL
# resolveReviewThread and its `glab api` counterpart, so the loop replies to a
# review thread and leaves closing it to the reviewer.
#
# Must stay synchronous — only a sync PreToolUse hook can deny — and it fires
# before every Bash call, so a keyword pre-filter keeps Node off the hot path.
# The filter is deliberately looser than the gate: it lets `unresolveReviewThread`
# and `resolved=false` through to guardrails.mjs, which allows both. Cheaper to
# pay one cold start on the rare inverse call than to encode the boundary twice
# and have the two drift. Degrades to {} so it never blocks an unrelated command.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="resolve-gate"

guardrail_wants() {
  guardrail_payload_matches 'resolveReviewThread|resolved=(true|false)'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
