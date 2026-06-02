#!/usr/bin/env bash
set -euo pipefail

# Front-door router (UserPromptSubmit). On the first build/implement/fix prompt
# of a session, offers to route the work through /muggle-do (build delegated to
# superpowers), gated by autoRouteBuildToMuggleDo. Fires once per session.
# Degrades to {} so it never blocks a turn.
root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
node "${root}/scripts/guardrails.mjs" build-router 2>/dev/null || printf '{}'
