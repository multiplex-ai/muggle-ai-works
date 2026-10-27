#!/usr/bin/env bash
set -uo pipefail

# Walkthrough rerun notice (PreToolUse/muggle local execution tools).
# A browser run about to start on a working tree whose branch has a PR will
# replace that PR's walkthrough, so the comment gets a banner saying a new run
# is in progress before the run starts — never a decision, always {}. The
# provider calls run in a detached job, keyed on the tree the tool call names.
#
# The pre-filter re-states the execution tool names, like the classify gate's,
# so an unrelated payload never pays Node cold-start. `[-_]` because Codex
# reports an MCP tool with underscores where the server spells hyphens.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="walkthrough-rerun-notice"

guardrail_wants() {
  guardrail_payload_matches 'muggle[-_]local[-_](execute[-_]test[-_]generation|execute[-_]replay)'
}

if guardrail_is_hook_script; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
