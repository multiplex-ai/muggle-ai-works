#!/usr/bin/env bash
set -uo pipefail

# PR-opened guardrail (PostToolUse/Bash). When a `gh pr create`/`gh pr ready`
# just succeeded, offer to start a muggle-pr-followup watcher on the new PR
# (gated by autoWatchPR, deduped per session). Decision logic lives in the
# bundled guardrails.mjs.
#
# This fires after EVERY Bash call, so a keyword pre-filter for the PR-open
# commands keeps Node off the hot path — only a `gh pr create|ready` or
# `glab mr create|update` even reaches guardrails.mjs, which then confirms the
# command succeeded and extracts the URL. Degrades to {} so it never blocks.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="pr-opened"

guardrail_wants() {
  guardrail_payload_matches 'gh[[:space:]]+pr[[:space:]]+(create|ready)|glab[[:space:]]+mr[[:space:]]+(create|update)'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
