#!/usr/bin/env bash
set -uo pipefail

# acted-on-review → threaded-reply gate (Stop). When a round pushed the change
# that addresses review comments and one of those comments still carries no
# reply, block the turn end until it does or a skip is declared.
#
# This must stay synchronous (only a sync Stop hook can block the turn end), and
# it fires on EVERY turn end. There is no command payload to key off, so the
# pre-filter reads the same per-session state file guardrails.mjs uses and only
# spawns Node when the gate could actually fire — i.e. a push is recorded, some
# comment was seen awaiting an answer, and no skip settled it. On the
# overwhelming majority of turns (no review round this session) the state file
# is absent or those fields are unset, so we return {} in-shell and never pay
# Node cold-start. Degrades to {}.
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
  || ! grep -q '"reviewWorkPushed": true' "$state_file" \
  || ! grep -q '"commentRepliesOwed"' "$state_file" \
  || grep -q '"commentRepliesOwed": \[\]' "$state_file" \
  || grep -q '"commentReplySkipped": true' "$state_file"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" comment-reply-gate 2>/dev/null || printf '{}'
