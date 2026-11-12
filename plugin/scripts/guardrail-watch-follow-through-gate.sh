#!/usr/bin/env bash
set -uo pipefail

# watcher follow-through gate (Stop). When a muggle-pr-followup watch this
# session owns has recorded due work — a rebase on a stale branch, a fix on a red
# head, review feedback the arm found unhandled — and no attempt for it is
# recorded, block the turn end and name the dispatch. Feedback a loop already
# reported still counts until last_seen.json records it handled or escalated. A muggle watch service report the session was never woken for blocks
# the same way, naming its tick, so a busy owner still hears every slot it owns.
# Released only by the attempt itself (for a report, the re-arm its tick ends
# on), a new head, or the user's own
# HOLD WATCH #<pr-number>: a session once sat on both for a day, re-arming its
# watch and asking "needs input" at every wake, and every prose rule against it
# held only as long as the session agreed with it.
#
# Synchronous (only a sync Stop hook can block the turn end) and fires on every
# turn end, so the pre-filter is bash builtins only: a glob over the slots for a
# non-empty watch-due.env (the watch loop empties it when nothing is due) or an
# undelivered service report, whose owner.json names this session. No slot has one on nearly every turn, so Node
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
  local slot_dir owner_json
  for slot_dir in "$sessions_dir"/*/; do
    slot_dir="${slot_dir%/}"
    [[ $slot_dir == *.stopped ]] && continue
    guardrail_slot_has_news "$slot_dir" || continue
    [[ -f $slot_dir/owner.json ]] || continue
    owner_json=""
    IFS= read -r -d '' owner_json <"$slot_dir/owner.json" || true
    [[ $owner_json == *"\"$session_id\""* ]] && return 0
  done
  return 1
}

# Whether a slot holds anything the gate judges: due work the watch recorded, or
# a muggle watch service report its owner was never woken for — queued while a
# fresh loop watches, or the exited service loop's own EVENT/TERMINAL line.
guardrail_slot_has_news() {
  local slot_dir="$1" service_output=""
  [[ -s $slot_dir/watch-due.env || -s $slot_dir/watch-service.queued.out ]] && return 0
  [[ -s $slot_dir/watch-service.out ]] || return 1
  IFS= read -r -d '' service_output <"$slot_dir/watch-service.out" || true
  service_output=$'\n'"$service_output"
  [[ $service_output == *$'\n'"EVENT "* || $service_output == *$'\n'"TERMINAL "* ]]
}

if guardrail_is_hook_script; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
