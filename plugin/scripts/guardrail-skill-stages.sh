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

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="skill-stages"

guardrail_wants() {
  local root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
  local key_pattern='"(skill|skillName|name|command)"[[:space:]]*:[[:space:]]*"([^"]*)"'
  local remaining="$GUARDRAIL_PAYLOAD"
  local candidate_words candidate skill
  while [[ $remaining =~ $key_pattern ]]; do
    remaining="${remaining#*"${BASH_REMATCH[0]}"}"
    read -r -a candidate_words <<<"${BASH_REMATCH[2]}"
    for candidate in "${candidate_words[@]}"; do
      skill="${candidate##*:}"
      skill="${skill#/}"
      case "$skill" in
        "" | *[!A-Za-z0-9._-]*) continue ;;
      esac
      [[ -f $root/skills/$skill/SKILL.md ]] && return 0
    done
  done
  return 1
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
