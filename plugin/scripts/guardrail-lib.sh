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
GUARDRAIL_STATE_FILE=""
GUARDRAIL_STATE=""
GUARDRAIL_STATE_LOADED=""
GUARDRAIL_HAS_STATE=""
GUARDRAIL_FIELD_VALUE=""

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

# Sets GUARDRAIL_FIELD_VALUE to the first "<name>": "<string>" in the payload, still JSON-escaped;
# returns 1 when the payload carries no such string field.
guardrail_payload_field() {
  local field_pattern='"'"$1"'"[[:space:]]*:[[:space:]]*"(([^"\\]|\\.)*)"'
  GUARDRAIL_FIELD_VALUE=""
  [[ $GUARDRAIL_PAYLOAD =~ $field_pattern ]] || return 1
  GUARDRAIL_FIELD_VALUE="${BASH_REMATCH[1]}"
}

# Case-insensitive ERE over the named payload fields, joined with a space in the order given;
# the last argument is the pattern. A tool's output and a read file's contents never reach it,
# so text that merely mentions a trigger cannot start Node on a pre-filter meant for the
# command that ran, the path that was read or the prompt that was sent.
guardrail_fields_match() {
  local pattern="${!#}"
  local haystack=""
  local field_name
  for field_name in "${@:1:$#-1}"; do
    guardrail_payload_field "$field_name" && haystack+=" $GUARDRAIL_FIELD_VALUE"
  done
  local matched=1
  shopt -s nocasematch
  [[ $haystack =~ $pattern ]] && matched=0
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

# Sets GUARDRAIL_STATE_FILE to this session's guardrail state file, named as sessionState.ts names it.
guardrail_resolve_state_file() {
  local session_id_pattern='"session_id"[[:space:]]*:[[:space:]]*"([^"]*)"'
  local raw_session_id="unknown"
  if [[ $GUARDRAIL_PAYLOAD =~ $session_id_pattern ]] && [[ -n ${BASH_REMATCH[1]} ]]; then
    raw_session_id="${BASH_REMATCH[1]}"
  fi
  guardrail_resolve_home
  GUARDRAIL_STATE_FILE="$GUARDRAIL_HOME/.muggle-ai/guardrails/${raw_session_id//[^A-Za-z0-9_-]/_}.json"
}

# Loads this session's guardrail state once per process; returns 1 when the session has none.
guardrail_load_state() {
  if [[ -z $GUARDRAIL_STATE_LOADED ]]; then
    GUARDRAIL_STATE_LOADED=1
    guardrail_resolve_state_file
    if [[ -f $GUARDRAIL_STATE_FILE ]]; then
      GUARDRAIL_HAS_STATE=1
      IFS= read -r -d '' GUARDRAIL_STATE <"$GUARDRAIL_STATE_FILE" || true
    fi
  fi
  [[ -n $GUARDRAIL_HAS_STATE ]]
}

# Fixed-string test against the loaded state (which sessionState writes pretty-printed).
guardrail_state_has() {
  [[ $GUARDRAIL_STATE == *"$1"* ]]
}

# Whether the gate script calling this is the hook's own script — run by bash, or sourced by hook-entry.sh into the
# shell Claude Code started — rather than a gate guardrail-dispatch.sh sourced only to read its pre-filter.
guardrail_is_hook_script() {
  [[ ${BASH_SOURCE[1]} == "${MUGGLE_HOOK_SCRIPT:-$0}" ]]
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
