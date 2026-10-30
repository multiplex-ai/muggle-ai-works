#!/usr/bin/env bash
set -uo pipefail

# tests-green-or-PR-opened → E2E gate (Stop). When unit tests passed this
# session or a PR was opened, and no E2E acceptance run has happened, offer to
# run change-driven E2E (gated by autoE2ETest). Fires once per session.
#
# This must stay synchronous (only a sync Stop hook can block the turn end), and
# it fires on EVERY turn end. There is no command payload to key off, so the
# pre-filter reads the same per-session state file guardrails.mjs uses and only
# spawns Node when the gate could actually fire — i.e. shouldRunE2E's two
# triggers, with no E2E run or accepted skip recorded yet. It must track that
# predicate exactly: a pre-filter narrower than the gate retires the gate
# silently, and one wider replays a block rendered before the skip landed. On the
# overwhelming majority of turns (no test run, no PR) the state file is absent,
# or unitTestsGreen is unset while prsHandled is empty, so we return {} in-shell
# and never pay Node cold-start. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="e2e-gate"

guardrail_wants() {
  guardrail_load_state \
    && { guardrail_state_has '"unitTestsGreen": true' || ! guardrail_state_has '"prsHandled": []'; } \
    && ! guardrail_state_has '"e2eReleased": true' \
    && ! guardrail_state_has '"e2eRun": true' \
    && ! guardrail_state_has '"e2eSkipped": true'
}

# Returns the block guardrails.mjs rendered ahead of time (writeE2eStopVerdict), without starting Node, while the
# budget it shares with Node's own blocks lasts. A Stop hook that outlives its one-second cap is dropped and the turn
# ends unblocked, and Node's cold start alone has taken seconds on a loaded Windows machine, so a block that waits on
# Node is one that can silently never land. Returns 1, leaving the decision and the release to Node, when nothing is
# rendered or the budget is spent.
guardrail_shell_verdict() {
  local verdict_file="${GUARDRAIL_STATE_FILE%.json}.e2e-stop-verdict"
  local shell_blocks_file="${GUARDRAIL_STATE_FILE%.json}.e2e-shell-blocks"
  [[ -f $verdict_file ]] || return 1
  local verdict=""
  IFS= read -r -d '' verdict <"$verdict_file" || true
  local max_blocks="${verdict%%$'\n'*}"
  local hook_output="${verdict#*$'\n'}"
  [[ $max_blocks =~ ^[0-9]+$ && -n $hook_output && $hook_output != "$verdict" ]] || return 1
  local recorded_blocks_pattern='"e2eBlockCount"[[:space:]]*:[[:space:]]*([0-9]+)'
  local recorded_blocks=0
  [[ $GUARDRAIL_STATE =~ $recorded_blocks_pattern ]] && recorded_blocks="${BASH_REMATCH[1]}"
  local shell_blocks=""
  [[ -f $shell_blocks_file ]] && { IFS= read -r -d '' shell_blocks <"$shell_blocks_file" || true; }
  ((recorded_blocks + ${#shell_blocks} < max_blocks)) || return 1
  { printf 'x' >>"$shell_blocks_file"; } 2>/dev/null || return 1
  printf '%s' "$hook_output"
}

if guardrail_is_hook_script; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
