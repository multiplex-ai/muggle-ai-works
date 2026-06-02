#!/usr/bin/env bash
set -euo pipefail

# PR-opened guardrail (PostToolUse/Bash). When a `gh pr create`/`gh pr ready`
# just succeeded, offer to start a muggle-pr-followup watcher on the new PR
# (gated by autoWatchPR, deduped per session). Decision logic lives in the
# bundled guardrails.mjs; this wrapper just pipes the event payload through and
# degrades to {} so a guardrail can never block a turn.
root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
node "${root}/scripts/guardrails.mjs" pr-opened 2>/dev/null || printf '{}'
