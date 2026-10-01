#!/usr/bin/env bash
set -uo pipefail

# Front-door router (UserPromptSubmit). On the first build/implement/fix prompt
# of a session, offers to route the work through /muggle-do (build delegated to
# superpowers), gated by autoRouteBuildToMuggleDo. Fires once per session.
#
# Node cold-start (spawn + module load) stalls the turn on a loaded box, and this
# hook runs on EVERY prompt. A cheap in-shell keyword pre-filter mirrors the build
# verbs guardrails.mjs looks for, so the vast majority of prompts (questions,
# status checks, chit-chat) never spawn Node. Node runs only on a keyword hit,
# then applies the real detectBuildIntent logic (question/slash exclusions,
# once-per-session dedupe). Over-matching here only costs an occasional needless
# spawn; it can never emit a spurious offer. Degrades to {} so it never blocks.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="build-router"

guardrail_wants() {
  guardrail_payload_matches '(implement|build|add|create|write|fix|refactor|wire up|hook up|make|change the|conflict|merged|passing|green)'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
