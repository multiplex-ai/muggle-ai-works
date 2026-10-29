#!/usr/bin/env bash

# The muggle-pr-followup watch loop. One process per PR slot: polls provider
# state silently, and exits as soon as a poll finds something — printing one line
# per new event — or the PR goes terminal.
#
# It runs as a background shell, which wakes the owning session only when the
# process exits. So a quiet PR costs the session nothing, and each report costs
# one turn, after which the session handles it and arms a fresh loop.
#
# Ships as a file so arming runs it rather than rewrites it. A loop re-derived
# from prose on every arm drifts — the behind-base wake went missing from half
# the slots on one machine that way, leaving PRs unmergeable under watchers that
# looked healthy. The wake conditions live in pr-watch-events.sh; this file is
# the I/O around them.
#
# Usage: pr-watch-loop.sh --slot <dir> --repo <owner/name> --pr <n> --base <branch>

set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

slot=""
repo=""
pr_number=""
base_branch="master"

while [ $# -gt 0 ]; do
    case "$1" in
        --slot) slot="$2"; shift 2 ;;
        --repo) repo="$2"; shift 2 ;;
        --pr) pr_number="$2"; shift 2 ;;
        --base) base_branch="$2"; shift 2 ;;
        *) echo "pr-watch-loop: unknown argument $1" >&2; exit 2 ;;
    esac
done

if [ -z "$slot" ] || [ -z "$repo" ] || [ -z "$pr_number" ]; then
    echo "pr-watch-loop: --slot, --repo and --pr are required" >&2
    exit 2
fi

# Resolved absolutely at arm time so they still load after the arming session is
# gone. Guards missing means the plugin moved or upgraded underneath this loop —
# a newer version's watcher owns the slot now, so step down rather than run on
# without the supersede check.
for lib in pr-watch-guards.sh pr-watch-events.sh pr-watch-fetch.sh pr-watch-due.sh pr-watch-floors.sh; do
    [ -f "${script_dir}/${lib}" ] || exit 0
    # shellcheck source=/dev/null
    . "${script_dir}/${lib}"
done

# Same reasoning as the guards: a missing projection means the plugin moved or
# upgraded underneath this loop, so step down rather than poll with no state to
# compare against.
[ -f "${script_dir}/pr-watch-state.jq" ] || exit 0
state_projection="$(cat "${script_dir}/pr-watch-state.jq")"

echo "$$" > "${slot}/watch.pid"
started=$(date +%s)
fails=0
unseeded=0
# Set once the first iteration has run. Until then the window cannot roll the
# loop over, so a start-up slow enough to spend the whole window still gets one
# look at the PR rather than handing back a watch that never polled.
has_iterated=""

# What watch-due.env last recorded, so the file is rewritten only when the due
# work changes rather than every poll.
due_rebase_key=""
recorded_due_work="unrecorded"

# Pin the token once: a detached loop can lose access to gh's OS keyring
# mid-run, which surfaces as empty fetches rather than an error.
pinned_token="$(gh auth token 2>/dev/null)"
[ -n "$pinned_token" ] && export GH_TOKEN="$pinned_token"


# What earlier loops already reported. Without these, work the session saw and
# chose not to act on — a HOLD WATCH, a comment needing no reply — would end
# every fresh loop on its first poll. A blocked-resume floor holds only for the
# block it was reported under (BLOCKED_FOR), so the same digest can resume a
# later block.
read_reported() {
    watch_read_slot_value "$slot" "$MUGGLE_PR_WATCH_REPORTED_FILE" "$1"
}
reported_review=$(read_reported REV)
reported_comment=$(read_reported COM)
reported_threads=$(read_reported THREADS)
floor_ci_red=$(read_reported CIRED)
floor_rebase=$(read_reported REBASED)
floor_blocked_digest=$(read_reported BLOCKED_CIDIGEST)
floor_blocked_for=$(read_reported BLOCKED_FOR)

read_watermark() {
    watch_read_slot_value "$slot" watch-watermark.env "$1"
}

higher_id() {
    if [ "${1:-0}" -gt "${2:-0}" ] 2>/dev/null; then printf '%s' "${1:-0}"; else printf '%s' "${2:-0}"; fi
}

# Every wait goes through here so that none, however long, can carry the loop
# past the end of its monitor window.
pause() {
    sleep "$(watcher_window_sleep "$started" "$(date +%s)" "$1")"
}

while :; do
    watcher_superseded "$slot" "$$" && exit 0
    if watcher_lifetime_exceeded "$started" "$(date +%s)"; then
        echo "EXPIRED pr=$pr_number watch lifetime of ${MUGGLE_PR_WATCH_MAX_LIFETIME}s reached — re-arm to keep watching"
        exit 0
    fi
    # Exit while the Monitor that owns this stdout is still reading, and say so:
    # the line is the owning session's cue to re-arm, and ending here is what
    # frees the lease that re-arm needs. A loop that ran on past its monitor would
    # keep that lease and heartbeat fresh while reporting to no one.
    if [ -n "$has_iterated" ] && watcher_window_elapsed "$started" "$(date +%s)"; then
        echo "ROLLOVER pr=$pr_number monitor window of ${MUGGLE_PR_WATCH_MONITOR_WINDOW}s elapsed — re-arm to keep watching"
        exit 0
    fi
    has_iterated=1
    touch "${slot}/watch-heartbeat" 2>/dev/null

    # No watermark yet means the arming session has not finished seeding. Wait
    # rather than treat every floor as zero, which would fire the whole backlog —
    # but not forever. Every wake condition below is evaluated against a floor
    # read from this file, so a loop that never gets one polls nothing, reports
    # nothing and never reaches the terminal check, while still holding its PID
    # lease and touching its heartbeat. That combination is the worst kind of
    # broken: reconcile reads the live lease and fresh beacon as healthy and
    # declines to re-arm, so the PR is silently unwatched for as long as the
    # session lives. Fail loudly instead.
    if [ ! -f "${slot}/watch-watermark.env" ]; then
        unseeded=$((unseeded + MUGGLE_PR_WATCH_POLL_INTERVAL))
        if watcher_unseeded_too_long "$unseeded"; then
            echo "WATCH-FAIL pr=$pr_number no watch-watermark.env after ${unseeded}s — arming never seeded it, so this watch can detect nothing (arm-watcher.md steps 1-2)"
            exit 1
        fi
        pause "$MUGGLE_PR_WATCH_POLL_INTERVAL"
        continue
    fi
    unseeded=0

    watermark_review=$(read_watermark REV)
    watermark_comment=$(read_watermark COM)
    watermark_threads=$(read_watermark THREADS)
    watermark_ci_red=$(read_watermark CIRED)
    watermark_rebase=$(read_watermark REBASED)
    watermark_blocked_digest=$(read_watermark BLOCKED_CIDIGEST)
    watermark_rebase_held=$(read_watermark REBASE_HELD)

    state_line=$(watch_fetch_state "$repo" "$pr_number" "$slot" "$state_projection")
    # One quick retry before counting a strike: a single flaky call should not
    # advance the failure budget.
    [ -z "$state_line" ] && { sleep 3; state_line=$(watch_fetch_state "$repo" "$pr_number" "$slot" "$state_projection"); }

    if [ -z "$state_line" ]; then
        fails=$((fails + 1))
        echo "$(date -u +%FT%TZ) fetch empty (${fails}/${MUGGLE_PR_WATCH_MAX_FETCH_FAILURES})" >> "${slot}/watch-fetch.log"
        if [ "$fails" -ge "$MUGGLE_PR_WATCH_MAX_FETCH_FAILURES" ]; then
            echo "WATCH-FAIL pr=$pr_number ${fails} consecutive fetch failures — see watch-fetch.log"
            exit 1
        fi
        pause "$(watcher_fetch_backoff "$fails")"
        continue
    fi

    watch_read_state_fields "$state_line"
    pr_state="${STATE_FIELDS[0]-}"
    head_sha="${STATE_FIELDS[1]-}"
    base_tip_sha="${STATE_FIELDS[2]-}"
    mergeable="${STATE_FIELDS[3]-}"
    latest_review="${STATE_FIELDS[4]-}"
    latest_comment="${STATE_FIELDS[5]-}"
    unresolved_threads="${STATE_FIELDS[6]-}"
    pending_checks="${STATE_FIELDS[7]-}"
    failed_checks="${STATE_FIELDS[8]-}"
    ci_digest="${STATE_FIELDS[9]-}"

    if [ "$pr_state" = "MERGED" ] || [ "$pr_state" = "CLOSED" ]; then
        echo "TERMINAL pr=$pr_number state=$pr_state"
        exit 0
    fi

    if [ "$pr_state" != "OPEN" ]; then
        fails=$((fails + 1))
        if [ "$fails" -ge "$MUGGLE_PR_WATCH_MAX_FETCH_FAILURES" ]; then
            echo "WATCH-FAIL pr=$pr_number unreadable state after ${fails} tries"
            exit 1
        fi
        pause "$(watcher_fetch_backoff "$fails")"
        continue
    fi
    fails=0
    has_reported=""

    watch_wake_review "$pr_number" "$latest_review" "$(higher_id "$watermark_review" "$reported_review")" && has_reported=1
    watch_wake_comment "$pr_number" "$latest_comment" "$(higher_id "$watermark_comment" "$reported_comment")" && has_reported=1

    if [ -n "$unresolved_threads" ]; then
        IFS=';' read -ra thread_ids <<< "$unresolved_threads"
        for thread_id in "${thread_ids[@]}"; do
            watch_wake_thread "$pr_number" "$thread_id" "${watermark_threads};${reported_threads}" && has_reported=1
        done
    fi

    # Either floor quiets the head: the watermark's when a fix already ran for
    # it, the reported one when a loop already told the session it went red.
    ci_red_floor="$watermark_ci_red"
    [ "$floor_ci_red" = "$head_sha" ] && ci_red_floor="$floor_ci_red"
    if watch_wake_ci_red "$pr_number" "$pending_checks" "$failed_checks" "$head_sha" "$ci_red_floor"; then
        floor_ci_red="$head_sha"
        has_reported=1
    fi

    rebase_key="${head_sha}..${base_tip_sha}"
    if [ "$watermark_rebase_held" = "1" ]; then
        # The PR spent its catch-up rebase budget: however far the base moves, the
        # tick refuses the rebase a wake would ask for, so nothing is due either.
        due_rebase_key=""
    elif [ "$rebase_key" = "$watermark_rebase" ] || [ "$rebase_key" = "$floor_rebase" ]; then
        # Only a key already found due is ever floored, and the pair's standing
        # cannot change until the head or the base moves, which mints a new key.
        due_rebase_key="$rebase_key"
    else
        behind_count=$(watch_fetch_behind_count "$repo" "$base_branch" "$head_sha" "$slot")
        due_rebase_key=""
        if watch_wake_rebase "$pr_number" "$mergeable" "$behind_count" "$rebase_key" ""; then
            floor_rebase="$rebase_key"
            due_rebase_key="$rebase_key"
            has_reported=1
        fi
    fi

    ci_red_head=""
    watch_checks_settled_red "$pending_checks" "$failed_checks" && ci_red_head="$head_sha"
    due_work="${head_sha} ${due_rebase_key} ${ci_red_head}"
    if [ "$due_work" != "$recorded_due_work" ]; then
        watch_record_due_work "$slot" "$head_sha" "$due_rebase_key" "$ci_red_head"
        recorded_due_work="$due_work"
    fi

    # The tick owns clearing the block, and it may not run for a while. Holding
    # the reported digest stops each fresh loop repeating it in the meantime — the
    # repeat nagging the design rules out — while a further move still wakes it.
    [ "$floor_blocked_for" = "$watermark_blocked_digest" ] || floor_blocked_digest=""
    if [ "$ci_digest" != "$floor_blocked_digest" ] \
        && watch_wake_blocked_resume "$pr_number" "$ci_digest" "$watermark_blocked_digest"; then
        floor_blocked_digest="$ci_digest"
        floor_blocked_for="$watermark_blocked_digest"
        has_reported=1
    fi

    if [ -n "$has_reported" ]; then
        watch_record_reported "$slot" "$(higher_id "$latest_review" "$reported_review")" \
            "$(higher_id "$latest_comment" "$reported_comment")" "$unresolved_threads" \
            "$floor_ci_red" "$floor_rebase" "$floor_blocked_digest" "$floor_blocked_for"
        exit 0
    fi

    pause "$MUGGLE_PR_WATCH_POLL_INTERVAL"
done
