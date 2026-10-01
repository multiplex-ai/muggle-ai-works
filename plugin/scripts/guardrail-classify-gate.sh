#!/usr/bin/env bash
set -uo pipefail

# pre-execution-classification gate (PreToolUse/muggle local execution tools).
# Denies a generation or replay whose test case was never classified per
# muggle-test Step 6f. That step calls muggle-remote-test-script-list, which is
# where the run finds out the test case has never passed or has failed
# repeatedly — the check is free before dispatch and costs a full browser run
# once skipped.
#
# The pre-filter re-states the execution tool names the gate acts on, so an
# unrelated payload never pays Node cold-start. It stays cheap by construction:
# an execution call happens minutes apart and burns a real browser, so the spawn
# is noise against what it protects. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="classify-gate"

guardrail_wants() {
  guardrail_payload_matches 'muggle-local-(execute-test-generation|execute-replay)'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
