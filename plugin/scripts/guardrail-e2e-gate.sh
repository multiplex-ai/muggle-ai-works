#!/usr/bin/env bash
set -euo pipefail

# tests-green → E2E gate (Stop). When unit tests passed this session and no E2E
# acceptance run has happened, offer to run change-driven E2E (gated by
# autoE2ETest). Fires once per session. Degrades to {} so it never blocks a turn.
root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
node "${root}/scripts/guardrails.mjs" e2e-gate 2>/dev/null || printf '{}'
