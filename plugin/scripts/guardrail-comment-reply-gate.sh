#!/usr/bin/env bash
set -uo pipefail

# claimed-review-thread → threaded-reply gate (Stop). When a round claimed a
# review thread and left it unanswered, block the turn end until it replies or
# the deferral is recorded.
#
# This must stay synchronous (only a sync Stop hook can block the turn end), and
# it fires on EVERY turn end. The obligation lives in the per-PR ledger rather
# than the session state file, so the pre-filter keys on a ledger existing at
# all: with no ledger anywhere there is nothing this gate could owe, and we
# return {} in-shell without paying Node cold-start. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="comment-reply-gate"

guardrail_wants() {
  guardrail_resolve_home
  local ledgers=("$GUARDRAIL_HOME"/.muggle-ai/muggle-do/sessions/*/comment-ledger.json)
  [[ -e ${ledgers[0]} ]] || return 1
  if guardrail_load_state; then
    ! guardrail_state_has '"commentReplySkipped": true' && ! guardrail_state_has '"commentReplyReleased": true'
  fi
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
