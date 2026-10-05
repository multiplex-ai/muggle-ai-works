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

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="walkthrough-heading-gate"

guardrail_wants() {
  guardrail_payload_matches 'gh[[:space:]]+pr[[:space:]]+(comment|create|edit)|issues/comments/[0-9]'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
