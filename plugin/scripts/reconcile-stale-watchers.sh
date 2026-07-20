#!/usr/bin/env bash

set -euo pipefail

# muggle-pr-followup watchers are session-only crons — they die on session end
# and on the 7-day /loop expiry, leaving open PRs with no live poller. Re-arming
# needs CronCreate, a Claude tool a shell hook can't call, so this hook can't
# recover a watcher itself. It nudges instead: on session start, if any open slot
# exists, it tells the agent to run reconcile (which finalizes terminal slots and
# re-arms silently-dead open watchers). A pure directory scan — no gh, no writes —
# so it stays cheap enough to run on every session start.

escape_for_json() {
    local s="$1"
    s="${s//\\/\\\\}"
    s="${s//\"/\\\"}"
    s="${s//$'\n'/\\n}"
    s="${s//$'\r'/\\r}"
    s="${s//$'\t'/\\t}"
    printf '%s' "$s"
}

# A slot is a live-or-dead open watcher iff it has prs.json (a tracked PR) but no
# result.md (not yet finalized). result.md is the terminal marker.
sessions_dir="${HOME}/.muggle-ai/muggle-do/sessions"
stale_count=0
if [ -d "$sessions_dir" ]; then
    for slot in "$sessions_dir"/*/; do
        [ -d "$slot" ] || continue
        if [ -f "${slot}prs.json" ] && [ ! -f "${slot}result.md" ]; then
            stale_count=$((stale_count + 1))
        fi
    done
fi

# Clean state: no open slots to reconcile → stay completely silent, never nudge.
if [ "$stale_count" -eq 0 ]; then
    exit 0
fi

if [ "$stale_count" -eq 1 ]; then
    slot_word="slot"
else
    slot_word="slots"
fi

context="muggle-pr-followup: ${stale_count} open watcher ${slot_word} found (a tracked PR with no result.md). Session-only watcher crons die on session end and after the 7-day /loop expiry, so these may have no live poller. Run \`/muggle:muggle-pr-followup reconcile\` to finalize any whose PR went terminal and re-arm silently-stopped open watchers. Reconcile is idempotent — it re-arms only genuinely dead watchers and stays quiet on the rest."

escaped_context=$(escape_for_json "$context")

if [ -n "${CURSOR_PLUGIN_ROOT:-}" ]; then
    printf '{\n  "additional_context": "%s"\n}\n' "$escaped_context"
elif [ -n "${CLAUDE_PLUGIN_ROOT:-}" ]; then
    printf '{\n  "hookSpecificOutput": {\n    "hookEventName": "SessionStart",\n    "additionalContext": "%s"\n  }\n}\n' "$escaped_context"
else
    printf '{\n  "additional_context": "%s"\n}\n' "$escaped_context"
fi

exit 0
