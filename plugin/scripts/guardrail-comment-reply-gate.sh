#!/usr/bin/env bash
set -uo pipefail

# claimed-review-thread → threaded-reply gate (Stop). When a round claimed a
# review thread and left it unanswered, block the turn end until it replies or
# the deferral is recorded.
#
# This must stay synchronous (only a sync Stop hook can block the turn end), and
# it fires on EVERY turn end. The obligation lives in the per-PR ledger rather
# than the session state file, so the pre-filter keys on a ledger existing at
# all: with no ledger anywhere there is nothing this gate could owe, and we
# return {} in-shell without paying Node cold-start. Degrades to {}.
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
if ! ls "$home"/.muggle-ai/muggle-do/sessions/*/comment-ledger.json >/dev/null 2>&1; then
  printf '{}'
  exit 0
fi
if [ -f "$state_file" ] && grep -q '"commentReplySkipped": true' "$state_file"; then
  printf '{}'
  exit 0
fi
if [ -f "$state_file" ] && grep -q '"commentReplyReleased": true' "$state_file"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" comment-reply-gate 2>/dev/null || printf '{}'
