#!/usr/bin/env bash
# Spawn-free plumbing shared by every guardrail hook, sourced by the gate scripts and by
# guardrail-dispatch.sh. Hooks fire on every tool call, prompt and turn end in every open
# session, and on Windows each process start costs 50ms healthy and seconds under load, so
# everything on the "this event is irrelevant" path is a bash builtin: payload and state are
# read with `read`, matched with [[ =~ ]] and glob tests, and the session id is sanitised with
# parameter expansion. Node starts only once a gate's pre-filter says it could fire.
# src/test/guardrails/footprint caps this in CI.

[[ -n ${GUARDRAIL_LIB_LOADED:-} ]] && return 0
GUARDRAIL_LIB_LOADED=1

GUARDRAIL_PAYLOAD=""
GUARDRAIL_STATE=""
GUARDRAIL_STATE_LOADED=""
GUARDRAIL_HAS_STATE=""

guardrail_read_payload() {
  IFS= read -r -d '' GUARDRAIL_PAYLOAD || true
}

# Case-insensitive ERE over the whole payload. Unanchored, so it matches everything the
# per-line `grep -Eiq` it replaced did; an over-match only costs a Node start.
guardrail_payload_matches() {
  local pattern="$1"
  local matched=1
  shopt -s nocasematch
  [[ $GUARDRAIL_PAYLOAD =~ $pattern ]] && matched=0
  shopt -u nocasematch
  return "$matched"
}

# The home Node's os.homedir() resolves. HOME is right on macOS/Linux and most Git Bash
# setups; when it doesn't hold the state dir, USERPROFILE (C:\Users\x) is converted to its
# Git Bash form (/c/Users/x) in-shell rather than through cygpath.
guardrail_resolve_home() {
  GUARDRAIL_HOME="${HOME:-}"
  local profile="${USERPROFILE:-}"
  if [[ ! -d $GUARDRAIL_HOME/.muggle-ai && $profile == [A-Za-z]:* ]]; then
    local drive="${profile:0:1}"
    local rest="${profile:2}"
    # Lower-cased by lookup, not ${drive,,}: macOS ships bash 3.2.
    local upper_letters="ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    local lower_letters="abcdefghijklmnopqrstuvwxyz"
    local letters_before="${upper_letters%%"$drive"*}"
    if [[ $letters_before != "$upper_letters" ]]; then
      drive="${lower_letters:${#letters_before}:1}"
    fi
    GUARDRAIL_HOME="/${drive}${rest//\\//}"
  fi
}

# Loads this session's guardrail state once per process; returns 1 when the session has none.
guardrail_load_state() {
  if [[ -z $GUARDRAIL_STATE_LOADED ]]; then
    GUARDRAIL_STATE_LOADED=1
    local session_id_pattern='"session_id"[[:space:]]*:[[:space:]]*"([^"]*)"'
    local raw_session_id="unknown"
    if [[ $GUARDRAIL_PAYLOAD =~ $session_id_pattern ]] && [[ -n ${BASH_REMATCH[1]} ]]; then
      raw_session_id="${BASH_REMATCH[1]}"
    fi
    guardrail_resolve_home
    local state_file="$GUARDRAIL_HOME/.muggle-ai/guardrails/${raw_session_id//[^A-Za-z0-9_-]/_}.json"
    if [[ -f $state_file ]]; then
      GUARDRAIL_HAS_STATE=1
      IFS= read -r -d '' GUARDRAIL_STATE <"$state_file" || true
    fi
  fi
  [[ -n $GUARDRAIL_HAS_STATE ]]
}

# Fixed-string test against the loaded state (which sessionState writes pretty-printed).
guardrail_state_has() {
  [[ $GUARDRAIL_STATE == *"$1"* ]]
}

# Runs guardrails.mjs on the payload. Never blocks a turn: any failure degrades to {}.
guardrail_run_node() {
  local root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
  printf '%s' "$GUARDRAIL_PAYLOAD" | node "${root}/scripts/guardrails.mjs" "$@" 2>/dev/null || printf '{}'
}

# Entry for a gate script executed directly: its guardrail_wants decides whether Node runs.
guardrail_run_standalone() {
  guardrail_read_payload
  if guardrail_wants; then
    guardrail_run_node "$1"
  else
    printf '{}'
  fi
}
