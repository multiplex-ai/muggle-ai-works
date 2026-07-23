#!/usr/bin/env bash

set -uo pipefail

# Prune ephemeral muggle state that nothing else garbage-collects, so it does not
# grow without bound (observed: hundreds of dead per-session files). Runs from a
# SessionStart hook, TTL-gated to once/day — the files are days old before they
# qualify, so a daily sweep is ample — unless MUGGLE_STATE_GC_FORCE=1. Silent and
# best-effort: it never blocks session start and never prints context.
#
#   guardrails/<session>.json   one per Claude session, read only by that
#       session's own hooks and useless once the session ends. Pruned after 14d.
#   muggle-do/sessions/<slug>/  a PR-follow-up slot. Pruned only once finalized
#       (result.md present — the terminal marker) and 30d old; its followup.log is
#       forensic-only and never read back by any skill.
#
# All age tests use `find -mmin/-mtime` (portable across GNU and BSD) rather than
# `date -r`, whose file-mtime meaning is GNU-only.

home="${HOME}"
guardrails_dir="${home}/.muggle-ai/guardrails"
sessions_dir="${home}/.muggle-ai/muggle-do/sessions"
marker_dir="${home}/.cache/muggle"
marker="${marker_dir}/state-gc-checked"
guardrails_ttl_days="${MUGGLE_GUARDRAILS_TTL_DAYS:-14}"
slot_ttl_days="${MUGGLE_SLOT_TTL_DAYS:-30}"

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
