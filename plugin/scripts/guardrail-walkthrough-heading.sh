#!/usr/bin/env bash
set -uo pipefail

# Walkthrough-heading gate (PreToolUse, Bash|PowerShell). Denies a
# `gh pr comment|create|edit` whose body wears the Muggle walkthrough heading or
# slot marker when no acceptance run has been recorded this session, so another
# tool's output cannot be published under Muggle's name.
#
# The report-format gate next to this one catches a hand-written *report*; a
# comment can carry the heading while containing no report structure at all,
# which is the shape that put Muggle's name on a run it never did.
#
# Must stay synchronous (only a sync PreToolUse hook can deny). The same keyword
# pre-filter keeps Node off the hot path for ordinary commands, and any failure
# degrades to {} so an unrelated command is never blocked.
payload="$(cat)"

if ! grep -Eiq 'gh[[:space:]]+pr[[:space:]]+(comment|create|edit)|issues/comments/[0-9]' <<<"$payload"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" walkthrough-heading-gate 2>/dev/null || printf '{}'
