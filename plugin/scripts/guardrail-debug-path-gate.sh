#!/usr/bin/env bash
set -uo pipefail

# debug-path gate (Stop). When a run failed this session and never went through
# _shared/debug-failed-run.md, block the turn end naming the run (or the
# MUGGLE_DEBUG_SKIP escape hatch). muggle-test Step 7C marks that routing
# mandatory and it was still routinely skipped, so failures were summarized and
# dropped — the run a reviewer most needs to see is the one nobody looked at.
#
# Mirrors guardrail-watch-gate.sh: synchronous (only a sync Stop hook can block
# the turn end), fires on EVERY turn end, and pre-filters in shell so Node spawns
# only when a failed run is recorded and unresolved. On the overwhelming majority
# of turns nothing failed, so the state file is absent or failedRuns is empty and
# we return {} in-shell. The evidence join runs in guardrails.mjs. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="debug-path-gate"

guardrail_wants() {
  guardrail_load_state \
    && guardrail_state_has '"failedRuns"' \
    && ! guardrail_state_has '"failedRuns": []' \
    && ! guardrail_state_has '"debugReleased": true' \
    && ! guardrail_state_has '"debugSkipped": true'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
