#!/usr/bin/env bash
set -uo pipefail

# acceptance-run → walkthrough gate (Stop). When an E2E acceptance run happened
# this session and no visual walkthrough has reached the PR, block the turn end
# until it does or a skip is declared. An accepted E2E skip arms it the same
# way: the PR must show the skip's record, because recording it in session
# state alone leaves reviewers an empty placeholder if the write never lands.
#
# This must stay synchronous (only a sync Stop hook can block the turn end), and
# it fires on EVERY turn end. There is no command payload to key off, so the
# pre-filter reads the same per-session state file guardrails.mjs uses and only
# spawns Node when the gate could actually fire — i.e. an acceptance run or an
# unsettled skip is recorded and the walkthrough is neither verified on every
# PR nor skipped. On the overwhelming majority of turns (no E2E this session)
# the state file is absent or carries neither, so we return {} in-shell and
# never pay Node cold-start — which also means the gate's `gh` lookups only
# ever run on turns that could genuinely owe a walkthrough. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="walkthrough-gate"

guardrail_wants() {
  guardrail_load_state || return 1
  guardrail_state_has '"walkthroughsVerified": true' && return 1
  guardrail_state_has '"walkthroughReleased": true' && return 1
  guardrail_state_has '"walkthroughSkipped": true' && return 1
  guardrail_state_has '"e2eRun": true' && return 0
  guardrail_state_has '"e2eSkipDeclaration": {' && ! guardrail_state_has '"e2eSkipSettledOnPrs": true'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
