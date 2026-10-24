#!/usr/bin/env bash
set -uo pipefail

# tests-green observer (PostToolUse/Bash + muggle E2E tools). Records in
# per-session state when a unit-test command passed (and when a muggle E2E run
# happened). Emits no directive — the Stop gate (guardrail-e2e-gate.sh) reads
# the state.
#
# Fires after every Bash call and every muggle execute/replay, so a keyword
# pre-filter for test runners and the muggle E2E tool names keeps Node off the
# hot path. Only a `test` command (npm/pnpm/yarn/jest/vitest/pytest/go/cargo),
# a muggle execute/replay/test-generation event, a skip marker, or a PR publish
# carrying a rendered walkthrough reaches guardrails.mjs, which then inspects
# the output for pass/fail and updates state. Degrades to {}.
#
# Each arm reads only the field guardrails.mjs judges it by — the command, or the
# tool's name. Against the whole payload, a jest config in a command's output or
# a cwd inside a muggle checkout would start Node on unrelated shell calls.
#
# The marker arm matches the MUGGLE_<GATE>_SKIP shape, never one token: every
# Stop gate documents its own marker as the escape hatch, and a per-token list
# left the watcher and walkthrough markers unreachable — the gates instructed
# the user to run an echo that could never reach the recorder, then blocked the
# turn anyway. Anchoring the marker to a leading `echo` stays in guardrails.mjs;
# over-matching here only costs a needless spawn.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="record-tests"

guardrail_wants() {
  guardrail_fields_match command '(pnpm|npm|yarn)[[:space:]]+(run[[:space:]]+)?test|jest|vitest|pytest|go[[:space:]]+test|cargo[[:space:]]+test|MUGGLE_[A-Z0-9_]+_SKIP|gh[[:space:]]+pr[[:space:]]+(comment|create|edit)|issues/comments/[0-9]' \
    || guardrail_fields_match tool_name 'muggle.*(execute|test[-_]generation|replay)'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
