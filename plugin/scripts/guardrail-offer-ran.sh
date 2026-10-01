#!/usr/bin/env bash
set -uo pipefail

# Next-options-offer observer (PostToolUse/AskUserQuestion). An AskUserQuestion
# call while a terminal PR is pending IS the post-merge handoff's exit: it
# clears terminalPending so the Stop gate (guardrail-terminal-gate.sh)
# releases. Emits no directive.
#
# Pre-filter: only spawn Node when the per-session state actually has a
# pending terminal PR, so the ordinary AskUserQuestion (no PR merged this
# session) never pays Node cold-start. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="offer-ran"

guardrail_wants() {
  guardrail_load_state \
    && guardrail_state_has '"terminalPending"' \
    && ! guardrail_state_has '"terminalPending": []'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
