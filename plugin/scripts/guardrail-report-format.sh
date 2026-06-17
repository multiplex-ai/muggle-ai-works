#!/usr/bin/env bash
set -euo pipefail

# Report-format gate (PreToolUse, Bash). Denies a `gh pr comment|create|edit`
# whose body reads like a hand-written E2E report — one that lacks the
# build-pr-section sentinel — so every posted walkthrough goes through the
# deterministic renderer. Degrades to {} so it never blocks an unrelated command.
root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
node "${root}/scripts/guardrails.mjs" report-gate 2>/dev/null || printf '{}'
