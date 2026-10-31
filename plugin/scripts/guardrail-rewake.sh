#!/usr/bin/env bash
set -uo pipefail

# Async companion of a synchronous guardrail hook (Stop, UserPromptSubmit). hooks.json runs it beside that hook with
# `async` and `asyncRewake`, handing it the same gate scripts:
#
#   guardrail-rewake.sh guardrail-e2e-gate.sh guardrail-watch-gate.sh ...
#
# Claude Code cancels the synchronous hook at its one-second cap and discards what it printed, and on a loaded Windows
# machine its own Git Bash start can spend that second, so a block or offer decided there can silently never land.
# Nothing waits on this one. When a gate's pre-filter could fire, or the synchronous run saved an output for the event,
# guardrails.mjs waits for the transcript to record how the synchronous run ended and, only when it was cancelled,
# prints what it would have said to stderr and exits 2, which wakes Claude with it. Every other firing ends here in
# shell, with no process started.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

guardrail_read_payload

firing_subcommands=()
for gate_script in "$@"; do
  GUARDRAIL_SUBCOMMAND=""
  . "$guardrail_script_dir/$gate_script" || continue
  if [[ -n $GUARDRAIL_SUBCOMMAND ]] && guardrail_wants; then
    firing_subcommands+=("$GUARDRAIL_SUBCOMMAND")
  fi
done

guardrail_payload_field hook_event_name || exit 0
guardrail_resolve_state_file
# Named as sessionState.ts names the sidecar SYNC_HOOK_OUTPUT_SUFFIX describes.
sync_output_file="${GUARDRAIL_STATE_FILE%.json}.${GUARDRAIL_FIELD_VALUE}-sync-output.json"
if [[ ${#firing_subcommands[@]} -eq 0 && ! -f $sync_output_file ]]; then
  exit 0
fi

# The expansion guard keeps an empty list from tripping `set -u` on bash 3.2.
guardrail_run_rewake_node rewake ${firing_subcommands[@]+"${firing_subcommands[@]}"}
