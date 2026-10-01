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

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="stage-gate"

guardrail_wants() {
  guardrail_load_state \
    && guardrail_state_has '"mandatoryStages"' \
    && ! guardrail_state_has '"mandatoryStages": []' \
    && ! guardrail_state_has '"stageReleased": true' \
    && ! guardrail_state_has '"stageSkipped": true'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
