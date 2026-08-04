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
#
# It also carries the fetch-resilience helper the loop uses so a transient
# provider blip does not kill a healthy watcher:
#
#   watcher_pin_token     — pins GH_TOKEN from the CLI at startup so the detached
#                           loop stops re-reading gh's OS keyring on every poll,
#                           the access a background process can silently lose.

MUGGLE_PR_WATCH_MAX_LIFETIME="${MUGGLE_PR_WATCH_MAX_LIFETIME:-21600}"
MUGGLE_PR_WATCH_POLL_INTERVAL="${MUGGLE_PR_WATCH_POLL_INTERVAL:-60}"
# Consecutive failed fetches before a loop gives up. Above the old 5 so a brief
# provider/network window (each poll already retried once by the loop) does not
# reach it; reconcile re-arms the slot at the next session start if it does.
MUGGLE_PR_WATCH_MAX_FETCH_FAILURES="${MUGGLE_PR_WATCH_MAX_FETCH_FAILURES:-8}"

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

# Export GH_TOKEN once so the detached loop authenticates every gh call from the
# environment instead of re-reading gh's OS keyring each poll. A background Git
# Bash process can lose keyring access mid-loop, which surfaces as silent empty
# fetches that march the loop to its failure cap; a token captured at arm time,
# while the session still holds keyring access, sidesteps that. No-op when a
# token is already set or none is obtainable (gh then falls back to its own
# resolution). The source command is overridable via MUGGLE_PR_GH_TOKEN_CMD.
watcher_pin_token() {
    [ -n "${GH_TOKEN:-}" ] && return 0
    local tok
    tok=$(${MUGGLE_PR_GH_TOKEN_CMD:-gh auth token} 2>/dev/null)
    [ -n "$tok" ] && export GH_TOKEN="$tok"
    return 0
}
