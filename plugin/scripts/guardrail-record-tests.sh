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
# a muggle execute/replay/test-generation event, a muggle-test skill telemetry
# emit (registers a clean-SKIP verdict as an E2E run), a skip marker, or a PR
# publish carrying a rendered walkthrough reaches guardrails.mjs, which then
# inspects the output for pass/fail and updates state. Degrades to {}.
#
# The marker arm matches the MUGGLE_<GATE>_SKIP shape, never one token: every
# Stop gate documents its own marker as the escape hatch, and a per-token list
# left the watcher and walkthrough markers unreachable — the gates instructed
# the user to run an echo that could never reach the recorder, then blocked the
# turn anyway. Anchoring the marker to a leading `echo` stays in guardrails.mjs;
# over-matching here only costs a needless spawn.
payload="$(cat)"

if ! grep -Eiq '(pnpm|npm|yarn)[[:space:]]+(run[[:space:]]+)?test|jest|vitest|pytest|go[[:space:]]+test|cargo[[:space:]]+test|muggle.*(execute|test-generation|replay)|muggle-local-telemetry-skill-emit|MUGGLE_[A-Z0-9_]+_SKIP|gh[[:space:]]+pr[[:space:]]+(comment|create|edit)|issues/comments/[0-9]' <<<"$payload"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" record-tests 2>/dev/null || printf '{}'
