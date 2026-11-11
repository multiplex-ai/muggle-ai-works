#!/usr/bin/env bash
set -uo pipefail

# PR-terminal guardrail (PostToolUse/Bash). When a PR just went terminal — a
# `gh pr merge`/`gh pr close` success line, or the `TERMINAL pr=N` line the
# pr-followup watch scripts print in a shell result — arm the post-merge handoff:
# record the PR as pending, nudge the model to finalize/tear down and offer
# next options, and hold the Stop gate (guardrail-terminal-gate.sh) until the
# offer runs. Decision logic lives in the bundled guardrails.mjs.
#
# Fires after every Bash call, so a keyword pre-filter for the terminal output
# shapes keeps Node off the hot path. The reopen line belongs here too: it is
# the one signal that retracts a terminal verdict, and while the pre-filter
# dropped it a close+reopen — routine, to re-fire a lost workflow trigger — left
# the handoff armed on a change that is open again. Degrades to {} so it never
# blocks.
#
# The output shapes are searched across the whole payload, which carries the
# command's full output, so the command is checked first: detectPrTerminal only
# reads the output of a merge, close or reopen, or of the watch scripts, and a
# payload with no command at all is left to it. Every other command ends here
# before its output is scanned.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="pr-terminal"

guardrail_wants() {
  if guardrail_payload_field command; then
    local terminal_command_pattern='(gh|glab)[[:space:]]+(pr|mr)[[:space:]]+(merge|close|reopen)|pr-watch-(loop|arm)\.sh'
    local is_terminal_command=1
    shopt -s nocasematch
    [[ $GUARDRAIL_FIELD_VALUE =~ $terminal_command_pattern ]] && is_terminal_command=0
    shopt -u nocasematch
    ((is_terminal_command == 0)) || return 1
  fi
  guardrail_payload_matches '(merged|closed|reopened) pull request|TERMINAL pr='
}

if guardrail_is_hook_script; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
