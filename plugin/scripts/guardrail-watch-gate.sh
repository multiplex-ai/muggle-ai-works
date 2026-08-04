#!/usr/bin/env bash
set -uo pipefail

# watcher-arm gate (Stop). When a PR was opened this session but no watcher was
# armed for it, block the turn end and point at the Stage-8 hand-off (or the
# MUGGLE_WATCH_SKIP escape hatch). Mirrors guardrail-e2e-gate.sh: synchronous
# (only a sync Stop hook can block the turn end), fires on EVERY turn end, and
# pre-filters in shell so Node spawns only when a PR was opened this session and
# no skip was recorded. The real owed-vs-armed decision (a sessions/*/ slot scan)
# runs in guardrails.mjs. On the overwhelming majority of turns no PR was opened,
# so the state file is absent or prsHandled is empty and we return {} in-shell,
# never paying Node cold-start. Degrades to {}.
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

# Empty array serializes as `"prsHandled": []` (one line); a non-empty array spans
# lines, so the empty match reliably tells them apart. Skip Node unless a PR was
# opened this session and no watcher skip was recorded.
state_file="$home/.muggle-ai/guardrails/$sid.json"
if [ ! -f "$state_file" ] \
  || ! grep -q '"prsHandled"' "$state_file" \
  || grep -q '"prsHandled": \[\]' "$state_file" \
  || grep -q '"watchSkipped": true' "$state_file"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" watch-gate 2>/dev/null || printf '{}'
