#!/usr/bin/env bash
set -uo pipefail

# build-followthrough gate (Stop). When the front-door router took a
# build/implement/fix prompt this session but no PR was ever opened, block the
# turn end and point at /muggle-do (or the MUGGLE_BUILD_SKIP escape hatch). The
# router's offer is advisory and a session that finds the root cause can still
# end without shipping it — the fix then lives only in a transcript that dies
# with the session, and no other gate catches it: the watcher gate only fires on
# a PR that already exists.
#
# Mirrors guardrail-watch-gate.sh: synchronous (only a sync Stop hook can block
# the turn end), fires on EVERY turn end, and pre-filters in shell so Node spawns
# only when a build request was routed and no PR was handled. On the
# overwhelming majority of turns no build intent was detected, so the state file
# is absent or the flag is unset and we return {} in-shell, never paying Node
# cold-start. Degrades to {}.
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

# A non-empty prsHandled array spans lines, so the empty match reliably says no
# PR was opened. Skip Node unless a build request was routed and nothing shipped.
state_file="$home/.muggle-ai/guardrails/$sid.json"
if [ ! -f "$state_file" ] \
  || ! grep -q '"buildIntentRouted": true' "$state_file" \
  || ! grep -q '"prsHandled": \[\]' "$state_file" \
  || grep -q '"buildSkipped": true' "$state_file"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" build-followthrough-gate 2>/dev/null || printf '{}'
