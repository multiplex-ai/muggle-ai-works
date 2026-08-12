#!/usr/bin/env bash
set -uo pipefail

# stage-read observer (PostToolUse/Read). Records that a file in the skills tree
# was opened, which is how the Stop gate tells a mandatory stage that was read
# from one that was skipped. Emits no directive.
#
# Read fires constantly, so only a markdown file living under a `skills/`
# directory reaches Node — a mandatory stage can be any file in that tree, but
# never one outside it, so source reads and repo docs return {} in-shell. Both
# path separators are accepted: a Windows payload carries escaped backslashes.
# Degrades to {}.
payload="$(cat)"

if ! grep -Eiq '"file_path"[[:space:]]*:[[:space:]]*"[^"]*[/\\]+skills[/\\]+[^"]*\.md"' <<<"$payload"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" record-stage-read 2>/dev/null || printf '{}'
