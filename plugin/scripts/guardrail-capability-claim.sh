#!/usr/bin/env bash
set -uo pipefail

# capability-claim gate (Stop). Catches the turn that tells the user an email- or
# login-gated flow can't be tested — the one class of blocker a managed login
# profile clears, with its live inbox, stored credentials, and CAPTCHA solver.
# Nudges once per session, then stays quiet.
#
# This must stay synchronous (only a sync Stop hook can block the turn end) and
# it fires on EVERY turn end, so the pre-filter has to be cheap. The claim lives
# in the assistant's prose. A payload carrying the closing message
# (`last_assistant_message` — Codex always sends it, Claude Code may) is
# searched in-shell; otherwise the filter greps the transcript tail for an
# impossibility word in-shell and spawns Node only on a hit. Node then applies
# the real per-sentence detector, which is what keeps a genuine SMS/TOTP limit
# from being "corrected". Over-matching here costs a needless spawn; it can
# never emit a spurious nudge. Degrades to {} so it never blocks on its own
# failure.

guardrail_script_dir="${BASH_SOURCE[0]%/*}"
[[ $guardrail_script_dir == "${BASH_SOURCE[0]}" ]] && guardrail_script_dir=.
. "$guardrail_script_dir/guardrail-lib.sh"

GUARDRAIL_SUBCOMMAND="capability-claim-gate"

guardrail_wants() {
  if guardrail_load_state && guardrail_state_has '"capabilityClaimNudged": true'; then
    return 1
  fi
  local claim_pattern='can.t|cannot|unable to|no way to|untestable|unverifiable|impossible|infeasible'
  local closing_message_pattern='"last_assistant_message"[[:space:]]*:[[:space:]]*"'
  if [[ $GUARDRAIL_PAYLOAD =~ $closing_message_pattern ]]; then
    guardrail_payload_matches "$claim_pattern"
    return
  fi
  local transcript_pattern='"transcript_path"[[:space:]]*:[[:space:]]*"([^"]*)"'
  [[ $GUARDRAIL_PAYLOAD =~ $transcript_pattern ]] || return 1
  local json_escaped_separator='\\'
  local transcript="${BASH_REMATCH[1]//"$json_escaped_separator"//}"
  [[ -f $transcript ]] || return 1
  # The one spawn left on a turn end: bash cannot seek, and reading a multi-MB transcript
  # in-shell costs more than a tail. Gone for the session once the gate has nudged.
  local transcript_tail
  transcript_tail="$(tail -c 20000 "$transcript" 2>/dev/null)"
  local matched=1
  shopt -s nocasematch
  [[ $transcript_tail =~ $claim_pattern ]] && matched=0
  shopt -u nocasematch
  return "$matched"
}

if guardrail_is_hook_script; then
  guardrail_run_standalone "$GUARDRAIL_SUBCOMMAND"
fi
