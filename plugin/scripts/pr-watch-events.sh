#!/usr/bin/env bash

# Wake conditions for the muggle-pr-followup watch loop — the single definition
# of what makes a quiet watcher speak. Sourced by pr-watch-loop.sh.
#
# These live in a file, rather than in the prose an arming session reads, because
# a re-derived loop silently loses conditions. Observed across four slots on one
# machine: two implemented the behind-base wake and two did not, and the two that
# did not left their PRs permanently unmergeable under a watcher that looked
# healthy — alive, heartbeating, no fetch errors, and nothing to say. A dropped
# wake has no failure mode that anyone notices.
#
# Every function is pure: arguments in, one event line on stdout, no I/O and no
# provider calls. That keeps each condition directly testable, which is the
# property prose never had. Exit 0 means "woke and emitted", 1 means "stay quiet".
# Each caller owns its own floor and advances it only on a real wake, so one
# occurrence fires exactly once.

# Splits the tab-separated state line into its fields, one per line, preserving
# empty ones. Not a wake, but every wake below reads its arguments out of this.
#
# `IFS=$'\t' read` cannot do it: tab is an IFS *whitespace* character, so bash
# collapses runs of tabs into a single delimiter, and the two adjacent tabs an
# empty field produces silently shift every later field left. With no unresolved
# thread — the common case, and also what a push leaves behind once its thread
# goes outdated — the thread field is empty, so the pending-check count lands in
# unresolved_threads and fires a thread wake for a PR with no threads, while the
# check digest lands in failed_checks and leaves red-CI detection reading a
# string where it expects a count. awk with an explicit FS does not collapse.
watch_split_state() {
    printf '%s\n' "$1" | awk -F'\t' '{for (i = 1; i <= NF; i++) print $i}'
}

# A submitted review newer than the floor. Monotonic ids, so `>` is the whole
# test. PENDING (unsubmitted) reviews are excluded by the caller's query — they
# are the reviewer's own drafts and are not feedback until submitted.
watch_wake_review() {
    local pr="$1" latest="$2" floor="$3"
    [ "${latest:-0}" -gt "${floor:-0}" ] 2>/dev/null || return 1
    echo "EVENT pr=$pr new submitted review id=$latest"
}

# A thread comment newer than the floor. Same monotonic-id reasoning as reviews.
watch_wake_comment() {
    local pr="$1" latest="$2" floor="$3"
    [ "${latest:-0}" -gt "${floor:-0}" ] 2>/dev/null || return 1
    echo "EVENT pr=$pr new thread comment id=$latest"
}

# A thread that is unresolved and not already known to be. `known` is the
# semicolon-joined THREADS floor; membership is the test, not ordering, because
# thread ids are opaque strings rather than a monotonic sequence.
watch_wake_thread() {
    local pr="$1" thread_id="$2" known="$3"
    [ -n "$thread_id" ] || return 1
    case ";${known};" in
        *";${thread_id};"*) return 1 ;;
    esac
    echo "EVENT pr=$pr thread newly unresolved id=$thread_id"
}

# The head's checks having **settled** red: nothing still pending and at least
# one failure. Pending-with-a-failure is not a wake — a run in flight may still
# go green, and the tick would idle on it anyway.
#
# The floor is the head SHA rather than a monotonic id because a check rollup is
# not monotonic: it flips green to red and resets on every push. Keying on the
# red head fires once per red head and re-arms on the next push.
watch_wake_ci_red() {
    local pr="$1" pending_count="$2" failed_count="$3" head_sha="$4" floor="$5"
    [ -n "$head_sha" ] || return 1
    [ "$head_sha" != "$floor" ] || return 1
    [ "${pending_count:-0}" -eq 0 ] 2>/dev/null || return 1
    [ "${failed_count:-0}" -gt 0 ] 2>/dev/null || return 1
    echo "EVENT pr=$pr checks settled red head=$head_sha"
}

# The branch needing a rebase onto its base — conflicting with it, or merely
# behind it.
#
# Behind is the half that regenerated loops kept dropping, and it is invisible
# from the signals a conflict check uses: a behind-but-clean branch reports
# mergeable=MERGEABLE, exactly like a current one. `mergeStateStatus` cannot
# stand in either — it is one enum with precedence, and BLOCKED (review
# required) masks BEHIND on any PR still awaiting approval, which is most of
# them. Behind-ness has to be measured, so the caller passes `behind_count` from
# a compare call.
#
# The floor is the rebase key `<head_sha>..<base_tip_sha>`, pairing both sides:
# staleness is a function of the pair, so a head-only key would wedge
# permanently the first time the base advanced (nothing can move the head while
# the branch sits blocked). Pairing re-arms whenever either side moves.
watch_wake_rebase() {
    local pr="$1" mergeable="$2" behind_count="$3" rebase_key="$4" floor="$5"
    [ -n "$rebase_key" ] || return 1
    [ "$rebase_key" != "$floor" ] || return 1
    if [ "$mergeable" = "CONFLICTING" ]; then
        echo "EVENT pr=$pr branch conflicting with base key=$rebase_key"
        return 0
    fi
    [ -n "$behind_count" ] && [ "$behind_count" -gt 0 ] 2>/dev/null || return 1
    echo "EVENT pr=$pr branch behind base by $behind_count — rebase due key=$rebase_key"
}

# A blocked watch whose CI signature moved at all. This is a resume probe, not a
# failure probe: it is dormant unless `blocked_digest` is set, and it wakes on
# any move away from that value rather than only on red, so a block waiting on a
# green pass, a rerun, or an external deploy check resumes as promptly as one
# waiting on a failure.
watch_wake_blocked_resume() {
    local pr="$1" digest="$2" blocked_digest="$3"
    [ -n "$blocked_digest" ] || return 1
    [ -n "$digest" ] || return 1
    [ "$digest" != "$blocked_digest" ] || return 1
    echo "EVENT pr=$pr ci digest moved while blocked — resume check"
}
