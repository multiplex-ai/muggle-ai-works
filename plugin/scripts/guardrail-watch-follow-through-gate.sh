#!/usr/bin/env bash
set -uo pipefail

# watcher follow-through gate (Stop). When a muggle-pr-followup watch this
# session owns has recorded due work — a rebase on a stale branch, a fix on a red
# head — and no attempt for it is recorded, block the turn end and name the
# dispatch. Released only by the attempt itself, a new head, or the user's own
# HOLD WATCH #<pr-number>: a session once sat on both for a day, re-arming its
# watch and asking "needs input" at every wake, and every prose rule against it
# held only as long as the session agreed with it.
#
# Synchronous (only a sync Stop hook can block the turn end) and fires on every
# turn end, so the pre-filter is bash builtins only: a glob over the slots for a
# non-empty watch-due.env (the watch loop empties it when nothing is due) whose
# owner.json names this session. No slot has one on nearly every turn, so Node
# never starts. The attempt counters, preferences, and the hold are judged in
# guardrails.mjs, from local files alone — no provider call. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="watch-follow-through-gate"

guardrail_wants() {
  guardrail_payload_field session_id || return 1
  local session_id="$GUARDRAIL_FIELD_VALUE"
  [[ -n $session_id ]] || return 1
  guardrail_resolve_home
  # A backslash in a glob escapes the next character, so a native Windows HOME
  # would match nothing; forward slashes name the same directory.
  local sessions_dir="${GUARDRAIL_HOME//\\//}/.muggle-ai/muggle-do/sessions"
  local due_file slot_dir owner_json
  for due_file in "$sessions_dir"/*/watch-due.env; do
    [[ -s $due_file ]] || continue
    slot_dir="${due_file%/watch-due.env}"
    [[ $slot_dir == *.stopped ]] && continue
    [[ -f $slot_dir/owner.json ]] || continue
    owner_json=""
    IFS= read -r -d '' owner_json <"$slot_dir/owner.json" || true
    [[ $owner_json == *"\"$session_id\""* ]] && return 0
  done
  return 1
}

if guardrail_is_hook_script; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
