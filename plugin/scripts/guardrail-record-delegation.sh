#!/usr/bin/env bash
set -uo pipefail

# Background acceptance-tester observer (PostToolUse/Agent|Task). Records that
# a change's E2E was handed to a muggle:acceptance-tester running in the
# background, so the E2E, walkthrough and debug-path Stop gates hold off rather
# than steer the main session into a second browser run alongside the agent's.
# Emits no directive.
#
# Pre-filter: most dispatches are other agents, so only a payload naming the
# acceptance-tester spawns Node. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="record-delegation"

guardrail_wants() {
  guardrail_payload_matches 'acceptance-tester'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
