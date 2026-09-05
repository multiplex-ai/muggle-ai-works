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

# Seconds a watch loop may live. 0 means unbounded — the `never` setting of the
# watcherLifetime preference, which removes the only time-based reaper for a
# loop whose session has gone. `watcher_superseded` is then the sole guard.
MUGGLE_PR_WATCH_MAX_LIFETIME="${MUGGLE_PR_WATCH_MAX_LIFETIME:-604800}"
MUGGLE_PR_WATCH_POLL_INTERVAL="${MUGGLE_PR_WATCH_POLL_INTERVAL:-60}"
# Consecutive failed fetches before a loop gives up. A watcher must ride through
# a GitHub / network outage — an observed drop lasted ~8 minutes — not die and
# leave the PR unwatched until its owning session next starts. With the backoff, 60
# spans hours; only a genuinely persistent unreachable slot (deleted repo,
# revoked auth) exhausts it.
MUGGLE_PR_WATCH_MAX_FETCH_FAILURES="${MUGGLE_PR_WATCH_MAX_FETCH_FAILURES:-60}"

# Seconds a loop will wait for the arming session to write watch-watermark.env
# before giving up. The loop cannot evaluate a single wake condition without it,
# so an unseeded slot is a watcher that will never report anything — and one that
# looks perfectly healthy while it does nothing, because it still holds its PID
# lease and still touches its heartbeat. Arming writes the file in the same turn
# it starts the loop, so anything past a couple of minutes means the arming
# sequence was not followed and the watch is inert.
MUGGLE_PR_WATCH_MAX_UNSEEDED="${MUGGLE_PR_WATCH_MAX_UNSEEDED:-180}"

# Seconds to sleep after `fails` consecutive failed fetches: the poll interval,
# then a linear back-off capped at 5 minutes so a sustained outage is retried
# calmly rather than hammered every 60s.
watcher_fetch_backoff() {
    local fails="$1" base="${MUGGLE_PR_WATCH_POLL_INTERVAL}" step secs
    step=$((fails * 30))
    secs=$((base + step))
    [ "$secs" -gt 300 ] && secs=300
    echo "$secs"
}

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
    # 0 is unbounded, not "already expired" — the arithmetic below would other-
    # wise make every loop exit on its first iteration.
    [ "$max" -eq 0 ] 2>/dev/null && return 1
    [ $((now - started)) -ge "$max" ]
}

# True when the slot has gone unseeded longer than the cap allows. 0 is
# unbounded, matching `watcher_lifetime_exceeded`, for a caller that seeds the
# watermark out of band.
watcher_unseeded_too_long() {
    local waited="$1" max="${2:-$MUGGLE_PR_WATCH_MAX_UNSEEDED}"
    [ "$max" -eq 0 ] 2>/dev/null && return 1
    [ "$waited" -ge "$max" ]
}

# True when pid names a running process. `kill -0` sends no signal; EPERM means
# the process exists but is foreign, which still counts as alive. Used by
# arm-watcher's pre-arm dedup to decide whether a watcher already owns the slot.
watcher_pid_alive() {
    local pid="$1"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null
}

# True when the slot's lease is held by a live loop that no longer belongs to the
# session arming now — the deaf-orphan case.
#
# A live PID proves the loop is running; it never proves anything is listening.
# On Windows a detached loop outlives the session that launched it, keeps
# polling, and keeps touching its heartbeat, while its stdout is the dead
# session's monitor pipe. Every liveness signal reads healthy and the events
# reach nobody. Because arming skipped on a live PID alone, that corpse blocked
# a live session from arming the PR for the whole lifetime cap — seven days
# since the default moved off six hours.
#
# Deliberately narrow. It answers only "is this lease held on behalf of some
# other session", which is decidable from state already on disk. It says nothing
# about a loop orphaned by its own session's monitor dying, where the owner still
# matches; that one needs a signal from the reader, which no file here carries.
#
# Conservative on every unknown — no watch.pid, a dead PID, no owner.json, or no
# current session id all answer false, so a slot is never reclaimed on a guess.
watcher_lease_is_foreign() {
    local slot="$1" current_session="$2" owner_pid owner_session
    [ -n "$current_session" ] || return 1
    [ -f "${slot}/watch.pid" ] || return 1
    owner_pid=$(tr -d ' \r\n' < "${slot}/watch.pid" 2>/dev/null)
    watcher_pid_alive "$owner_pid" || return 1
    [ -f "${slot}/owner.json" ] || return 1
    owner_session=$(sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${slot}/owner.json" | head -1)
    [ -n "$owner_session" ] || return 1
    [ "$owner_session" != "$current_session" ]
}
