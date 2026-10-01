#!/usr/bin/env bash
set -uo pipefail

# One hook command per event instead of one per gate. hooks.json calls this with the gate
# scripts that event feeds, in order:
#
#   guardrail-dispatch.sh guardrail-e2e-gate.sh guardrail-watch-gate.sh ...
#
# It reads the payload once, sources each gate (defining its guardrail_wants pre-filter and
# GUARDRAIL_SUBCOMMAND without running it), and asks every pre-filter in this one process.
# Irrelevant events — nearly all of them — end here with {} and no process started. When any
# gate could fire, Node runs once for all of them (`guardrails.mjs run <gates...>`), merging
# their outputs the way the harness merged separate hooks.

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

if [[ ${#firing_subcommands[@]} -eq 0 ]]; then
  printf '{}'
  exit 0
fi
guardrail_run_node run "${firing_subcommands[@]}"
