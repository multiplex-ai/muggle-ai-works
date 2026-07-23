#!/usr/bin/env bash

# Self-termination guards for the muggle-pr-followup watch loop. Sourced by the
# per-slot watch.sh that arm-watcher writes, and the single source of truth for
# the two conditions that stop a watcher from leaking across sessions.
#
# A bare `while true` monitor leaks on Windows: the OS does not stop a detached
# Git Bash loop when the Claude session that launched it ends, so orphaned
# watchers accumulate and each keeps spawning gh calls forever. Two guards bound
# that, and together with arm-watcher's pre-arm dedup keep at most one live
# watcher per PR:
#
#   watcher_superseded    — <slot>/watch.pid holds the PID of the watcher that
#                           owns the slot. A loop whose PID no longer matches has
#                           been replaced by a newer arm and must exit.
#   watcher_lifetime_exceeded — a loop exits after MUGGLE_PR_WATCH_MAX_LIFETIME
#                           regardless, so an orphan nothing supersedes still dies
#                           on its own; reconcile re-arms an open PR inside a live
#                           session.

MUGGLE_PR_WATCH_MAX_LIFETIME="${MUGGLE_PR_WATCH_MAX_LIFETIME:-21600}"
MUGGLE_PR_WATCH_POLL_INTERVAL="${MUGGLE_PR_WATCH_POLL_INTERVAL:-60}"

# True when watch.pid exists and names a PID other than this loop's — a newer arm
# has taken ownership of the slot. Absent/empty watch.pid is not superseded: a
# loop that has not yet claimed the slot keeps running.
watcher_superseded() {
    local slot="$1" mypid="$2" owner
    [ -f "${slot}/watch.pid" ] || return 1
    owner=$(cat "${slot}/watch.pid" 2>/dev/null)
    [ -n "$owner" ] && [ "$owner" != "$mypid" ]
}

watcher_lifetime_exceeded() {
    local started="$1" now="$2" max="${3:-$MUGGLE_PR_WATCH_MAX_LIFETIME}"
    [ $((now - started)) -ge "$max" ]
}

# True when pid names a running process. `kill -0` sends no signal; EPERM means
# the process exists but is foreign, which still counts as alive. Used by
# arm-watcher's pre-arm dedup to decide whether a watcher already owns the slot.
watcher_pid_alive() {
    local pid="$1"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null
}
