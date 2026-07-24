#!/usr/bin/env bash

set -uo pipefail

# Prune ephemeral muggle state that nothing else garbage-collects, so it does not
# grow without bound (observed: hundreds of dead per-session files). Runs from a
# SessionStart hook, TTL-gated to once/day unless MUGGLE_STATE_GC_FORCE=1. Silent
# and best-effort: it never blocks session start and never prints context.
#
# Collection is keyed on INACTIVITY, never creation age, so a session that lasts
# months is never collected while it is still in use:
#
#   guardrails/<session>.json   one per Claude session. An in-use session keeps
#       rewriting it (guardrails.mjs on every guarded tool call) and refreshes it
#       on resume (below), so its mtime tracks last activity — only a session gone
#       quiet for the whole window is collected, and by then it has ended.
#   muggle-do/sessions/<slug>/  a PR-follow-up slot. Pruned only once finalized
#       (result.md present — the terminal marker); an OPEN slot, a PR watched for
#       any length of time, has no result.md and is never touched.
#
# Age tests use `find -mmin/-mtime` (portable across GNU and BSD) rather than
# `date -r`, whose file-mtime meaning is GNU-only.

home="${HOME}"
guardrails_dir="${home}/.muggle-ai/guardrails"
sessions_dir="${home}/.muggle-ai/muggle-do/sessions"
marker_dir="${home}/.cache/muggle"
marker="${marker_dir}/state-gc-checked"
guardrails_ttl_days="${MUGGLE_GUARDRAILS_TTL_DAYS:-14}"
slot_ttl_days="${MUGGLE_SLOT_TTL_DAYS:-30}"

# Refresh this session's own guardrails file before anything else, every start
# (not behind the daily gate — a resume on an already-swept day must still mark
# the session live). This is what makes a long-lived or resumed session immune to
# the inactivity sweep, whatever its age. Filename sanitization mirrors
# guardrails.mjs fileFor().
session_id=$(cat 2>/dev/null | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
if [ -n "${session_id}" ]; then
    safe_id="${session_id//[^A-Za-z0-9_-]/_}"
    [ -f "${guardrails_dir}/${safe_id}.json" ] && touch "${guardrails_dir}/${safe_id}.json" 2>/dev/null || true
fi

# TTL gate: skip when the marker exists and is younger than 24h (1440 min).
if [ -z "${MUGGLE_STATE_GC_FORCE:-}" ] && [ -f "$marker" ] \
    && [ -z "$(find "$marker" -mmin +1440 2>/dev/null)" ]; then
    exit 0
fi

if [ -d "$guardrails_dir" ]; then
    find "$guardrails_dir" -maxdepth 1 -type f -name '*.json' \
        -mtime "+${guardrails_ttl_days}" -delete 2>/dev/null || true
fi

if [ -d "$sessions_dir" ]; then
    for slot in "$sessions_dir"/*/; do
        [ -d "$slot" ] || continue
        [ -f "${slot}result.md" ] || continue
        if [ -n "$(find "${slot}result.md" -mtime "+${slot_ttl_days}" 2>/dev/null)" ]; then
            rm -rf "$slot" 2>/dev/null || true
        fi
    done
fi

mkdir -p "$marker_dir" 2>/dev/null || true
touch "$marker" 2>/dev/null || true
exit 0
