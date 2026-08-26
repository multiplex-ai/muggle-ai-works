#!/usr/bin/env bash
set -uo pipefail

# capability-claim gate (Stop). Catches the turn that tells the user an email- or
# login-gated flow can't be tested — the one class of blocker a managed login
# profile clears, with its live inbox, stored credentials, and CAPTCHA solver.
# Nudges once per session, then stays quiet.
#
# This must stay synchronous (only a sync Stop hook can block the turn end) and
# it fires on EVERY turn end, so the pre-filter has to be cheap. A Stop payload
# carries no message text, only a transcript path, and the claim lives in the
# assistant's prose — so the filter greps the transcript tail for an
# impossibility word in-shell and spawns Node only on a hit. Node then applies
# the real per-sentence detector, which is what keeps a genuine SMS/TOTP limit
# from being "corrected". Over-matching here costs a needless spawn; it can
# never emit a spurious nudge. Degrades to {} so it never blocks on its own
# failure.
payload="$(cat)"

transcript="$(printf '%s' "$payload" \
  | grep -oE '"transcript_path"[[:space:]]*:[[:space:]]*"[^"]*"' \
  | head -1 \
  | sed -E 's/.*:[[:space:]]*"([^"]*)".*/\1/' \
  | sed 's/\\\\/\//g')"

if [ -z "$transcript" ] || [ ! -f "$transcript" ]; then
  printf '{}'
  exit 0
fi

if ! tail -c 20000 "$transcript" \
  | grep -Eiq 'can.t|cannot|unable to|no way to|untestable|unverifiable|impossible|infeasible'; then
  printf '{}'
  exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
printf '%s' "$payload" | node "${root}/scripts/guardrails.mjs" capability-claim-gate 2>/dev/null || printf '{}'
