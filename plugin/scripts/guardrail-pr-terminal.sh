#!/usr/bin/env bash
set -uo pipefail

# PR-terminal guardrail (PostToolUse/Bash + Monitor). When a PR just went
# terminal — a `gh pr merge`/`gh pr close` success line or the pr-followup
# watch monitor's `TERMINAL pr=N` exit line — arm the post-merge handoff:
# record the PR as pending, nudge the model to finalize/tear down and offer
# next options, and hold the Stop gate (guardrail-terminal-gate.sh) until the
# AskUserQuestion offer runs. Decision logic lives in the bundled guardrails.mjs.
#
# Fires after every Bash call, so a keyword pre-filter for the terminal output
# shapes keeps Node off the hot path. The reopen line belongs here too: it is
# the one signal that retracts a terminal verdict, and while the pre-filter
# dropped it a close+reopen — routine, to re-fire a lost workflow trigger — left
# the handoff armed on a change that is open again. Degrades to {} so it never
# blocks.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="pr-terminal"

guardrail_wants() {
  guardrail_payload_matches '(merged|closed|reopened) pull request|TERMINAL pr='
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
