#!/usr/bin/env bash
set -uo pipefail

# Report-format gate (PreToolUse, Bash). Denies a `gh pr comment|create|edit`
# whose body reads like a hand-written E2E report — one that lacks the
# build-pr-section sentinel — so every posted walkthrough goes through the
# deterministic renderer.
#
# This must stay synchronous (only a sync PreToolUse hook can deny), and it fires
# before every Bash call. A keyword pre-filter for the PR-publishing commands
# keeps Node off the hot path: a plain `ls`/`git status`/build command returns {}
# in-shell and never pays cold-start. Only a `gh pr comment|create|edit` or a
# `gh api` comment edit reaches guardrails.mjs, which reads the body (incl.
# --body-file) and decides. The comment-edit arm matters as much as the post
# arm: guardrails.mjs gates that path precisely so a sanctioned walkthrough
# can't be overwritten with hand-written markdown afterwards, and a pre-filter
# on `gh pr` alone left that bypass wide open. Degrades to {} so it never blocks
# an unrelated command.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="report-gate"

guardrail_wants() {
  guardrail_payload_matches 'gh[[:space:]]+pr[[:space:]]+(comment|create|edit)|issues/comments/[0-9]'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
