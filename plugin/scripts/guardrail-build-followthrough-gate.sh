#!/usr/bin/env bash
set -uo pipefail

# build-followthrough gate (Stop). When the front-door router took a
# build/implement/fix prompt this session but no PR was ever opened, block the
# turn end and point at /muggle-do (or the MUGGLE_BUILD_SKIP escape hatch). The
# router's offer is advisory and a session that finds the root cause can still
# end without shipping it — the fix then lives only in a transcript that dies
# with the session, and no other gate catches it: the watcher gate only fires on
# a PR that already exists.
#
# Mirrors guardrail-watch-gate.sh: synchronous (only a sync Stop hook can block
# the turn end), fires on EVERY turn end, and pre-filters in shell so Node spawns
# only when a build request was routed and no PR was handled. On the
# overwhelming majority of turns no build intent was detected, so the state file
# is absent or the flag is unset and we return {} in-shell, never paying Node
# cold-start. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="build-followthrough-gate"

guardrail_wants() {
  guardrail_load_state \
    && guardrail_state_has '"buildIntentRouted": true' \
    && guardrail_state_has '"prsHandled": []' \
    && ! guardrail_state_has '"buildSkipped": true'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
