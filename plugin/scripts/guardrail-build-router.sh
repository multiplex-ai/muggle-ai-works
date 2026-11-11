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
# never fire again, so its state flag ends the check in-shell. detectBuildIntent
# drops a question or a slash command whatever verbs it holds, so those end here
# too, except a /muggle-do or /mdo command, which Node must see to arm the gate.
#
# A pasted log makes the prompt hundreds of KB, and capturing it with a regex costs
# about 1.5 ms per KB, so the prompt is never extracted. The payload is cut at its
# "prompt" key, which a string value cannot spell unescaped, and the question and
# slash checks read only the head of what follows while the verbs are glob
# substring tests, several times cheaper than one alternation regex. Whatever
# follows the prompt in the payload is searched too, which only over-matches.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="build-router"

# Matched case-insensitively as substrings, so "muggle-do" and "mdo" cover every
# /muggle-do, /muggle:mdo and $mdo spelling.
BUILD_ROUTER_WORDS=(implement build add create write fix refactor "wire up" "hook up" make "change the" conflict merged passing green muggle-do mdo)

guardrail_wants() {
  if guardrail_load_state && guardrail_state_has '"buildIntentRouted": true'; then
    return 1
  fi
  local prompt_key='"prompt"'
  [[ $GUARDRAIL_PAYLOAD == *"$prompt_key"* ]] || return 1
  local prompt_onward="${GUARDRAIL_PAYLOAD#*"$prompt_key"}"
  local value_opening_pattern='^[[:space:]]*:[[:space:]]*"'
  [[ ${prompt_onward:0:64} =~ $value_opening_pattern ]] || return 1
  prompt_onward="${prompt_onward:${#BASH_REMATCH[0]}}"
  local prompt_head="${prompt_onward:0:256}"
  # The prompt is still JSON-escaped: an escaped newline, return or tab counts as leading
  # space, and any other escape leaves the prompt to Node. The value's closing quote ends
  # a command name the way the end of the prompt does.
  local leading_space='^([[:space:]]|\\[nrt])*'
  local question_pattern="$leading_space"'(why|what|how|when|where|who|is|are|does|do|can you (explain|tell)|explain)([^A-Za-z0-9_]|$)'
  local slash_command_pattern="$leading_space"'/'
  local muggle_do_command_pattern="$leading_space"'/([A-Za-z0-9_-]+:)?(muggle-do|mdo)([[:space:]]|\\|"|$)'
  local is_rejected_by_node=1
  shopt -s nocasematch
  if [[ $prompt_head =~ $question_pattern ]]; then
    is_rejected_by_node=0
  elif [[ $prompt_head =~ $slash_command_pattern && ! $prompt_head =~ $muggle_do_command_pattern ]]; then
    is_rejected_by_node=0
  fi
  local is_build_word_found=1
  if ((is_rejected_by_node == 1)); then
    local build_word
    for build_word in "${BUILD_ROUTER_WORDS[@]}"; do
      if [[ $prompt_onward == *"$build_word"* ]]; then
        is_build_word_found=0
        break
      fi
    done
  fi
  shopt -u nocasematch
  return "$is_build_word_found"
}

if guardrail_is_hook_script; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
