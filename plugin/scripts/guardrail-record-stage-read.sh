#!/usr/bin/env bash
set -uo pipefail

# stage-read observer (PostToolUse/Read, and PostToolUse/Bash through the
# dispatcher). Records that a file in the skills tree was opened, which is how
# the Stop gate tells a mandatory stage that was read from one that was skipped.
# A host with no Read tool (Codex) opens stage files through the shell — `cat`,
# `sed -n` — so a shell command that prints one counts as a read too. Emits no
# directive.
#
# Read and Bash fire constantly, so only a payload naming a markdown file under a
# `skills/` directory reaches Node — a mandatory stage lives in that tree, never
# outside it, so source reads and repo docs return {} in-shell. The match is
# loose on purpose: a shell command quotes its path inside an escaped JSON
# string, or names it relative to a `cd` into the skills tree or to the `cwd`
# the payload carries. Over-matching costs one Node start; Node resolves the
# path for real. Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="record-stage-read"

guardrail_wants() {
  guardrail_payload_matches 'skills.*\.md'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
