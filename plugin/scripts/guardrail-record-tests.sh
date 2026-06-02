#!/usr/bin/env bash
set -euo pipefail

# tests-green observer (PostToolUse/Bash). Records in per-session state when a
# unit-test command passed (and when a muggle E2E run happened). Emits no
# directive — the Stop gate (guardrail-e2e-gate.sh) reads the state. Degrades
# to {} so it never blocks a turn.
root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
node "${root}/scripts/guardrails.mjs" record-tests 2>/dev/null || printf '{}'
