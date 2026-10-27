#!/usr/bin/env bash
set -uo pipefail

# Front-door router (UserPromptSubmit). On the first build/implement/fix prompt
# of a session, offers to route the work through /muggle-do (build delegated to
# superpowers), gated by autoRouteBuildToMuggleDo. A direct /muggle-do or /mdo
# invocation gets no offer but arms the build follow-through gate the same way.
# Fires once per session.
#
# Node cold-start (spawn + module load) stalls the turn on a loaded box, and this
# hook runs on EVERY prompt. A cheap in-shell keyword pre-filter mirrors the build
# verbs guardrails.mjs looks for, so the vast majority of prompts (questions,
# status checks, chit-chat) never spawn Node. Node runs only on a keyword hit,
# then applies the real detectBuildIntent and isMuggleDoForwardInvocation logic
# (question/slash exclusions, muggle-do's menu and watcher directives,
# once-per-session dedupe). Over-matching here only costs an occasional needless
# spawn; it can never emit a spurious offer. Degrades to {} so it never blocks.
#
# The verbs are matched in the prompt alone, since a hex session id can spell
# "add" and a cwd can hold "build". Once the session has been routed the offer can
# never fire again, so its state flag ends the check in-shell.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="build-router"

guardrail_wants() {
  if guardrail_load_state && guardrail_state_has '"buildIntentRouted": true'; then
    return 1
  fi
  guardrail_fields_match prompt '(implement|build|add|create|write|fix|refactor|wire up|hook up|make|change the|conflict|merged|passing|green|[/$](muggle:)?(muggle-do|mdo))'
}

if guardrail_is_hook_script; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
