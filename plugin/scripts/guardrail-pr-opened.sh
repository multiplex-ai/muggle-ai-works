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
payload="$(cat)"

if ! grep -Eiq 'gh[[:space:]]+pr[[:space:]]+(create|ready)|glab[[:space:]]+mr[[:space:]]+(create|update)' <<<"$payload"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" pr-opened 2>/dev/null || printf '{}'
