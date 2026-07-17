#!/usr/bin/env bash
set -uo pipefail

# tests-green observer (PostToolUse/Bash + muggle E2E tools). Records in
# per-session state when a unit-test command passed (and when a muggle E2E run
# happened). Emits no directive — the Stop gate (guardrail-e2e-gate.sh) reads
# the state.
#
# Fires after every Bash call and every muggle execute/replay, so a keyword
# pre-filter for test runners and the muggle E2E tool names keeps Node off the
# hot path. Only a `test` command (npm/pnpm/yarn/jest/vitest/pytest/go/cargo) or
# a muggle execute/replay/test-generation event reaches guardrails.mjs, which
# then inspects the output for pass/fail and updates state. Degrades to {}.
payload="$(cat)"

if ! grep -Eiq '(pnpm|npm|yarn)[[:space:]]+(run[[:space:]]+)?test|jest|vitest|pytest|go[[:space:]]+test|cargo[[:space:]]+test|muggle.*(execute|test-generation|replay)' <<<"$payload"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" record-tests 2>/dev/null || printf '{}'
