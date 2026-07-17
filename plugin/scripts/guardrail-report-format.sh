#!/usr/bin/env bash
set -uo pipefail

# Report-format gate (PreToolUse, Bash). Denies a `gh pr comment|create|edit`
# whose body reads like a hand-written E2E report — one that lacks the
# build-pr-section sentinel — so every posted walkthrough goes through the
# deterministic renderer.
#
# This must stay synchronous (only a sync PreToolUse hook can deny), and it fires
# before every Bash call. A keyword pre-filter for the three PR-posting commands
# keeps Node off the hot path: a plain `ls`/`git status`/build command returns {}
# in-shell and never pays cold-start. Only a `gh pr comment|create|edit` reaches
# guardrails.mjs, which reads the body (incl. --body-file) and decides. Degrades
# to {} so it never blocks an unrelated command.
payload="$(cat)"

if ! grep -Eiq 'gh[[:space:]]+pr[[:space:]]+(comment|create|edit)' <<<"$payload"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" report-gate 2>/dev/null || printf '{}'
