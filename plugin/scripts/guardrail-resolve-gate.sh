#!/usr/bin/env bash
set -uo pipefail

# Review-thread resolve gate (PreToolUse, Bash). Denies a `gh api` GraphQL
# resolveReviewThread and its `glab api` counterpart, so the loop replies to a
# review thread and leaves closing it to the reviewer.
#
# Must stay synchronous — only a sync PreToolUse hook can deny — and it fires
# before every Bash call, so a keyword pre-filter keeps Node off the hot path.
# The filter is deliberately looser than the gate: it lets `unresolveReviewThread`
# and `resolved=false` through to guardrails.mjs, which allows both. Cheaper to
# pay one cold start on the rare inverse call than to encode the boundary twice
# and have the two drift. Degrades to {} so it never blocks an unrelated command.
payload="$(cat)"

if ! grep -Eiq 'resolveReviewThread|resolved=(true|false)' <<<"$payload"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" resolve-gate 2>/dev/null || printf '{}'
