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

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="watch-gate"

guardrail_wants() {
  guardrail_load_state \
    && guardrail_state_has '"prsHandled"' \
    && ! guardrail_state_has '"prsHandled": []' \
    && ! guardrail_state_has '"watchReleased": true' \
    && ! guardrail_state_has '"watchSkipped": true'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
