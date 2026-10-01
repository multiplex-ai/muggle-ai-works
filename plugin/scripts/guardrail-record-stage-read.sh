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

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="record-stage-read"

guardrail_wants() {
  guardrail_payload_matches '"file_path"[[:space:]]*:[[:space:]]*"[^"]*[/\\]+skills[/\\]+[^"]*\.md"'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
