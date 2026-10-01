#!/usr/bin/env bash
set -uo pipefail

# comment-reply observer (PostToolUse/Bash). Records the two things the reply
# gate settles from: the unresolved-thread fetch a review round works from,
# which claims each thread it names, and the threaded-reply POSTs that cover the
# comments in them. Emits no directive — the Stop gate reads the ledger.
#
# Fires after every Bash call, so a keyword pre-filter keeps Node off the hot
# path: only a thread fetch, a reply POST, or a skip marker reaches
# guardrails.mjs, which then parses the provider response and updates the ledger.
# The claim is what marks a thread as taken, so a push is no longer a signal and
# spawning Node on one would be pure waste.
#
# The marker arm matches the MUGGLE_<GATE>_SKIP shape, never one token, for the
# same reason the other observers do: a gate whose marker is missing from a
# hand-listed set instructs the user to run an echo that can never register,
# then blocks the turn anyway. Over-matching here only costs a needless spawn.
# Degrades to {}.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="record-comment-replies"

guardrail_wants() {
  guardrail_payload_matches 'reviewThreads|merge_requests/[0-9]+/discussions|comments/[0-9]+/replies|discussions/[A-Za-z0-9_-]+/notes|MUGGLE_[A-Z0-9_]+_SKIP'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
