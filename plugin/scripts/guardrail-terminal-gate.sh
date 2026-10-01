#!/usr/bin/env bash
set -uo pipefail

# PR-terminal → post-merge handoff gate (Stop). When a PR went terminal this
# session (merged/closed) and the next-options offer hasn't run, block the
# turn end until the handoff — finalize, teardown, AskUserQuestion offer —
# happens. Releases unconditionally after 3 blocks.
#
# This must stay synchronous (only a sync Stop hook can block the turn end),
# and it fires on EVERY turn end. There is no command payload to key off, so
# the pre-filter reads the same per-session state file guardrails.mjs uses and
# only spawns Node when a terminal PR is actually pending. On the overwhelming
# majority of turns no PR went terminal, so the state file is absent or
# terminalPending is empty and we return {} in-shell. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="terminal-gate"

guardrail_wants() {
  guardrail_load_state \
    && guardrail_state_has '"terminalPending"' \
    && ! guardrail_state_has '"terminalReleased": true' \
    && ! guardrail_state_has '"terminalPending": []'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
