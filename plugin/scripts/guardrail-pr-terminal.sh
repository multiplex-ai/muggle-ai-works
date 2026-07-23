#!/usr/bin/env bash
set -uo pipefail

# PR-terminal guardrail (PostToolUse/Bash + Monitor). When a PR just went
# terminal — a `gh pr merge`/`gh pr close` success line or the pr-followup
# watch monitor's `TERMINAL pr=N` exit line — arm the post-merge handoff:
# record the PR as pending, nudge the model to finalize/tear down and offer
# next options, and hold the Stop gate (guardrail-terminal-gate.sh) until the
# AskUserQuestion offer runs. Decision logic lives in the bundled guardrails.mjs.
#
# Fires after every Bash call, so a keyword pre-filter for the terminal output
# shapes keeps Node off the hot path. Degrades to {} so it never blocks.
payload="$(cat)"

if ! grep -Eiq 'merged pull request|closed pull request|TERMINAL pr=' <<<"$payload"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" pr-terminal 2>/dev/null || printf '{}'
