#!/usr/bin/env bash
set -uo pipefail

# acceptance-run → walkthrough gate (Stop). When an E2E acceptance run happened
# this session and no visual walkthrough has reached the PR, block the turn end
# until it does or a skip is declared. Fires once per session per PR.
#
# This must stay synchronous (only a sync Stop hook can block the turn end), and
# it fires on EVERY turn end. There is no command payload to key off, so the
# pre-filter reads the same per-session state file guardrails.mjs uses and only
# spawns Node when the gate could actually fire — i.e. an acceptance run is
# recorded and the walkthrough is neither posted nor skipped. On the
# overwhelming majority of turns (no E2E this session) the state file is absent
# or e2eRun is unset, so we return {} in-shell and never pay Node cold-start —
# which also means the gate's `gh` lookups only ever run on turns that could
# genuinely owe a walkthrough. Degrades to {}.
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
  || ! grep -q '"e2eRun": true' "$state_file" \
  || grep -q '"walkthroughPosted": true' "$state_file" \
  || grep -q '"walkthroughReleased": true' "$state_file" \n  || grep -q '"walkthroughSkipped": true' "$state_file"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" walkthrough-gate 2>/dev/null || printf '{}'
