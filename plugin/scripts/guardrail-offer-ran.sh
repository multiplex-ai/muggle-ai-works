#!/usr/bin/env bash
set -uo pipefail

# Next-options-offer observer (PostToolUse/AskUserQuestion). An AskUserQuestion
# call while a terminal PR is pending IS the post-merge handoff's exit: it
# clears terminalPending so the Stop gate (guardrail-terminal-gate.sh)
# releases. Emits no directive.
#
# Pre-filter: only spawn Node when the per-session state actually has a
# pending terminal PR, so the ordinary AskUserQuestion (no PR merged this
# session) never pays Node cold-start. Degrades to {}.
payload="$(cat)"

raw_sid="$(printf '%s' "$payload" | grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)".*/\1/')"
[ -n "$raw_sid" ] || raw_sid="unknown"
sid="$(printf '%s' "$raw_sid" | sed 's/[^A-Za-z0-9_-]/_/g')"

# Resolve the same home dir Node's os.homedir() uses. HOME is correct on
# macOS/Linux and on most Git Bash setups; fall back to converting USERPROFILE
# when HOME doesn't hold the state dir (some Windows shells point HOME elsewhere).
home="${HOME:-}"
if [ ! -d "$home/.muggle-ai" ] && command -v cygpath >/dev/null 2>&1 && [ -n "${USERPROFILE:-}" ]; then
  home="$(cygpath -u "$USERPROFILE" 2>/dev/null || printf '%s' "$home")"
fi

state_file="$home/.muggle-ai/guardrails/$sid.json"
if [ ! -f "$state_file" ] \
  || ! grep -q '"terminalPending"' "$state_file" \
  || grep -q '"terminalPending": \[\]' "$state_file"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" offer-ran 2>/dev/null || printf '{}'
