#!/usr/bin/env bash
set -uo pipefail

# muggle-pr-followup watch monitors and recovery crons are session-bound — a
# session that ends or hits its usage limit takes them with it, and the
# session-start reconcile nudge only helps once a human starts a session. This
# hook keeps the out-of-session recovery substrate alive instead: when any open
# watcher slot exists, it ensures the detached watchdog daemon
# (pr-followup-watchdog.mjs) is running. The daemon polls dead slots with plain
# gh/glab calls (per the slot's provider) and spawns a headless recovery tick
# when a slot needs one, retrying
# through usage-limit windows — so watchers resume after a limit reset with no
# user action. Idempotent: a live daemon (lockfile pid + fresh heartbeat) is
# left alone.

sessions_dir="${HOME}/.muggle-ai/muggle-do/sessions"
open_slot_exists=0
if [ -d "$sessions_dir" ]; then
    for slot in "$sessions_dir"/*/; do
        [ -d "$slot" ] || continue
        if [ -f "${slot}prs.json" ] && [ ! -f "${slot}result.md" ]; then
            open_slot_exists=1
            break
        fi
    done
fi

if [ "$open_slot_exists" -eq 0 ]; then
    printf '{}'
    exit 0
fi

root="${CLAUDE_PLUGIN_ROOT:-${CURSOR_PLUGIN_ROOT:-}}"
if [ -n "$root" ] && command -v node >/dev/null 2>&1; then
    node "${root}/scripts/pr-followup-watchdog.mjs" ensure >/dev/null 2>&1 || true
fi

printf '{}'
exit 0
