#!/usr/bin/env bash
set -uo pipefail

# mandatory-stage gate (Stop). When a skill invoked this session declared
# `mandatoryStages` in its SKILL.md and any of those files was never opened,
# block the turn end naming them (or the MUGGLE_STAGE_SKIP escape hatch). This
# is the root fix for a skill read as a single page: the SKILL.md links out to
# steps that are mandatory, nothing forced them open, and the steps were
# silently dropped.
#
# Mirrors guardrail-watch-gate.sh: synchronous (only a sync Stop hook can block
# the turn end), fires on EVERY turn end, and pre-filters in shell so Node spawns
# only when a stage is actually owed. On the overwhelming majority of turns no
# skill declared stages, so the state file is absent or mandatoryStages is empty
# and we return {} in-shell. The read-vs-declared comparison runs in
# guardrails.mjs. Degrades to {}.
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

# Empty array serializes as `"mandatoryStages": []` (one line); a non-empty array
# spans lines, so the empty match reliably tells them apart.
state_file="$home/.muggle-ai/guardrails/$sid.json"
if [ ! -f "$state_file" ] \
  || ! grep -q '"mandatoryStages"' "$state_file" \
  || grep -q '"mandatoryStages": \[\]' "$state_file" \
  || grep -q '"stageReleased": true' "$state_file" \
  || grep -q '"stageSkipped": true' "$state_file"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" stage-gate 2>/dev/null || printf '{}'
