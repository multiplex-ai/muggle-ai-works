#!/usr/bin/env bash

set -euo pipefail

# muggle-pr-followup watchers are session-bound — they die on session end and on
# the 7-day /loop expiry, leaving open PRs with no live poller. Re-arming needs
# Claude tools a shell hook can't call, so this hook nudges rather than acts.
#
# The nudge is owner-scoped. Each slot records the session that armed it in
# owner.json; only slots owned by THIS session are a recovery the agent should
# run, because re-arming a stranger's PR would hand review work to a session with
# no context for it. A session that owns none hears nothing: the hook speaks into
# every session start, and slots owned elsewhere are no work of this one's —
# `muggle watch status` reports them.
#
# A slot registered with the muggle watch service needs no nudge either: the
# service restarts its loop outside the session and wakes the session only with
# that PR's own report. A session gets this hook's context only on a resume or
# a compaction, mid-work, so nudging a sweep for a slot the service already
# keeps would only cut into that work. A pure directory scan — no gh, no
# writes, bash builtins only — so it stays cheap enough for every session start
# however many slots have piled up.

hook_dir="${BASH_SOURCE[0]%/*}"
[ "$hook_dir" = "${BASH_SOURCE[0]}" ] && hook_dir=.
. "${hook_dir}/guardrail-lib.sh"

escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# Sets owner_session_id to the first "session_id": "..." in an owner.json, read
# in-shell: this runs for every open slot on every session start, and a
# sed|head|tr pipeline per slot costs seconds on Windows. jq is not guaranteed
# present, and on Windows it appends CRLF that makes an empty field compare
# non-empty.
read_owner_session_id() {
    local owner_json=""
    local session_id_pattern='"session_id"[[:space:]]*:[[:space:]]*"([^"]*)"'
    owner_session_id=""
    IFS= read -r -d '' owner_json <"$1" || true
    if [[ $owner_json =~ $session_id_pattern ]]; then
        owner_session_id="${BASH_REMATCH[1]}"
    fi
}

guardrail_read_payload
current_session_id=""
if guardrail_payload_field session_id; then
    current_session_id="$GUARDRAIL_FIELD_VALUE"
fi

# A slot is an open watcher iff it has prs.json (a tracked PR) and no result.md
# (not yet finalized). A *.stopped dir is the owner's kill switch — it keeps its
# prs.json, so the name check is the only thing that distinguishes a slot the
# owner deliberately killed from one awaiting recovery. Counting those reports
# stopped watchers back as work.
sessions_dir="${HOME}/.muggle-ai/muggle-do/sessions"
owned_count=0

if [ -d "$sessions_dir" ]; then
    for slot in "$sessions_dir"/*/; do
        [ -d "$slot" ] || continue
        case "$slot" in *.stopped/) continue ;; esac
        [ -f "${slot}prs.json" ] || continue
        [ ! -f "${slot}result.md" ] || continue
        [ ! -f "${slot}watch-registration.json" ] || continue

        slot_owner=""
        if [ -f "${slot}owner.json" ]; then
            read_owner_session_id "${slot}owner.json"
            slot_owner="$owner_session_id"
        fi

        # Fail closed: an unidentifiable session owns nothing. Absent owner.json
        # (legacy slot) is likewise foreign — never adopted by default.
        if [ -n "$current_session_id" ] && [ "$slot_owner" = "$current_session_id" ]; then
            owned_count=$((owned_count + 1))
        fi
    done
fi

[ "$owned_count" -gt 0 ] || exit 0

if [ "$owned_count" -eq 1 ]; then
    owned_word="watcher"
else
    owned_word="watchers"
fi

context="muggle-pr-followup: ${owned_count} open ${owned_word} owned by this session, not kept by the muggle watch service, may have lost its poller. Run \`/muggle:muggle-pr-followup reconcile\` to finalize any whose PR went terminal and re-arm the silently-stopped ones. Reconcile is idempotent and re-arms only watchers this session armed itself."

escaped_context=$(escape_for_json "$context")

if [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
    printf '{\n  "additional_context": "%s"\n}\n' "$escaped_context"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$escaped_context"
else
    printf '{\n  "additional_context": "%s"\n}\n' "$escaped_context"
fi

exit 0
