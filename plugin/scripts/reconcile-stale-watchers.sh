#!/usr/bin/env bash

set -euo pipefail

# muggle-pr-followup watchers are session-bound — they die on session end and on
# the 7-day /loop expiry, leaving open PRs with no live poller. Re-arming needs
# Claude tools a shell hook can't call, so this hook nudges rather than acts.
#
# The nudge is owner-scoped. Each slot records the session that armed it in
# owner.json; only slots owned by THIS session are a recovery the agent should
# run, because re-arming a stranger's PR would hand review work to a session with
# no context for it. Slots owned by another session (or none) are reported as
# orphans with the adopt command, never as work to pick up. A pure directory scan
# — no gh, no writes — so it stays cheap enough for every session start.

escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# Extract the first "session_id": "..." from a JSON file or string. Deliberately
# sed rather than jq: jq is not guaranteed present, and on Windows it appends CRLF
# that makes an empty field compare non-empty.
read_session_id() {
    sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -1 | tr -d '\r'
}

hook_payload=$(cat 2>/dev/null || true)
current_session_id=$(printf '%s' "$hook_payload" | read_session_id /dev/stdin)

# A slot is an open watcher iff it has prs.json (a tracked PR) and no result.md
# (not yet finalized). A *.stopped dir is the owner's kill switch — it keeps its
# prs.json, so the name check is the only thing that distinguishes a slot the
# owner deliberately killed from one awaiting recovery. Counting those reports
# stopped watchers back as work.
sessions_dir="${HOME}/.muggle-ai/muggle-do/sessions"
owned_count=0
orphan_count=0
first_orphan_slug=""

if [ -d "$sessions_dir" ]; then
    for slot in "$sessions_dir"/*/; do
        [ -d "$slot" ] || continue
        case "$slot" in *.stopped/) continue ;; esac
        [ -f "${slot}prs.json" ] || continue
        [ ! -f "${slot}result.md" ] || continue

        slot_owner=""
        if [ -f "${slot}owner.json" ]; then
            slot_owner=$(read_session_id "${slot}owner.json")
        fi

        # Fail closed: an unidentifiable session owns nothing. Absent owner.json
        # (legacy slot) is likewise foreign — never adopted by default.
        if [ -n "$current_session_id" ] && [ "$slot_owner" = "$current_session_id" ]; then
            owned_count=$((owned_count + 1))
        else
            orphan_count=$((orphan_count + 1))
            if [ -z "$first_orphan_slug" ]; then
                first_orphan_slug=$(basename "$slot")
            fi
        fi
    done
fi

# Clean state: nothing of this session's to recover and no orphans → stay silent.
if [ "$owned_count" -eq 0 ] && [ "$orphan_count" -eq 0 ]; then
    exit 0
fi

if [ "$owned_count" -eq 1 ]; then
    owned_word="watcher"
else
    owned_word="watchers"
fi

if [ "$owned_count" -gt 0 ]; then
    context="muggle-pr-followup: ${owned_count} open ${owned_word} owned by this session may have lost its poller. Run \`/muggle:muggle-pr-followup reconcile\` to finalize any whose PR went terminal and re-arm the silently-stopped ones. Reconcile is idempotent and re-arms only watchers this session armed itself."
else
    context="muggle-pr-followup: no watchers belong to this session — nothing to re-arm."
fi

if [ "$orphan_count" -gt 0 ]; then
    if [ "$orphan_count" -eq 1 ]; then
        orphan_word="slot is"
    else
        orphan_word="slots are"
    fi
    context="${context} ${orphan_count} open ${orphan_word} owned by other sessions; reconcile will finalize them if their PR already merged or closed, but will never re-arm them. Adopt one deliberately with \`/muggle:muggle-pr-followup adopt <slug>\` (e.g. ${first_orphan_slug}) only if the user asks — do not offer or adopt on your own."
fi

escaped_context=$(escape_for_json "$context")

if [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
    printf '{\n  "additional_context": "%s"\n}\n' "$escaped_context"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$escaped_context"
else
    printf '{\n  "additional_context": "%s"\n}\n' "$escaped_context"
fi

exit 0
