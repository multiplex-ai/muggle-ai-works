#!/usr/bin/env bash
set -uo pipefail

# stage-signal observer (PostToolUse/Bash + muggle telemetry and feedback tools).
# Records the three things the stage gates settle from: a Step 6f
# pre-execution-classification emit, debug-path evidence for a failed run (a
# failure-classified emit or feedback naming it), and the skip markers each gate
# documents as its way out. Emits no directive — the gates read the state.
#
# The marker arm matches the MUGGLE_<GATE>_SKIP shape, never one token: a gate
# whose marker is missing from a hand-listed set instructs the user to run an
# echo that can never register, then blocks the turn anyway. Anchoring the
# marker to a leading `echo` stays in guardrails.mjs; over-matching here only
# costs a needless spawn. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="record-stage-signals"

guardrail_wants() {
  guardrail_payload_matches 'MUGGLE_[A-Z0-9_]+_SKIP|muggle.*(telemetry-event-emit|user-feedback-create)'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
