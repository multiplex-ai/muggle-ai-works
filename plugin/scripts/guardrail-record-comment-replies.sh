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
payload="$(cat)"

if ! grep -Eiq 'reviewThreads|merge_requests/[0-9]+/discussions|comments/[0-9]+/replies|discussions/[A-Za-z0-9_-]+/notes|MUGGLE_[A-Z0-9_]+_SKIP' <<<"$payload"; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" record-comment-replies 2>/dev/null || printf '{}'
