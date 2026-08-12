#!/usr/bin/env bash
set -uo pipefail

# mandatory-stage recorder (PostToolUse/Skill). Records which skill is running
# and, when its SKILL.md declares `mandatoryStages`, returns those files as
# required reading at the moment of use. The Stop gate
# (guardrail-stage-gate.sh) blocks the turn end while any of them is unread.
#
# Skill calls are rare, so the pre-filter is a file test rather than a keyword
# scan: the invoked name is pulled out of the payload and Node runs only when it
# resolves to a skill this plugin actually ships. Another plugin's skill, or an
# input with no skill name, returns {} in-shell. Every key the resolver reads is
# accepted here — a key matched in one and missed in the other makes the gate
# dead code on exactly the harness that names it that way. Degrades to {}.
payload="$(cat)"

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"

for candidate in $(printf '%s' "$payload" \
  | grep -oE '"(skill|skillName|name|command)"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | sed -E 's/.*:[[:space:]]*"([^"]*)".*/\1/'); do
  # A namespaced invocation (`muggle:muggle-test`) and a slash command
  # (`/muggle-test`) both name the same skill directory.
  skill="${candidate##*:}"
  skill="${skill#/}"
  case "$skill" in
    "" | *[!A-Za-z0-9._-]*) continue ;;
  esac
  if [ -f "$root/skills/$skill/SKILL.md" ]; then
    printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" skill-stages 2>/dev/null || printf '{}'
    exit 0
  fi
done

printf '{}'
