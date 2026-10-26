#!/usr/bin/env bash

# Records the work a watch has seen due on its PR — a rebase or red CI — so the
# owning session's turn-end gate can tell an event it acted on from one it sat
# on. Sourced by pr-watch-arm.sh and pr-watch-loop.sh.
#
# The gate runs in a Stop hook with about a second to answer and no network, so
# it cannot ask the provider what is due; it reads this file and the slot's
# attempt counters instead. A session once held a stale branch and a red head
# for a day by re-arming its watch, whose drain floored both as "handled", and
# answering every wake with a question. Nothing on disk said the work was due,
# so nothing could notice. This file is that record.
#
# Rewritten whole each time what is due changes; left empty when nothing is, so
# the gate's shell pre-filter reads an empty file as nothing owed.

MUGGLE_PR_WATCH_DUE_FILE="watch-due.env"

# Writes <slot>/watch-due.env: the head the observation was made on, the
# `<head>..<base-tip>` key of a rebase found due (empty when the branch is
# current), and the head whose checks settled red (empty otherwise). Builtins
# only, since the loop writes it every time what is due changes.
watch_record_due_work() {
    local slot="$1" head_sha="$2" rebase_due_key="$3" ci_red_head="$4"
    if [ -z "$rebase_due_key" ] && [ -z "$ci_red_head" ]; then
        : > "${slot}/${MUGGLE_PR_WATCH_DUE_FILE}"
        return 0
    fi
    printf 'HEAD="%s"\nREBASE_DUE="%s"\nCI_RED_HEAD="%s"\n' "$head_sha" "$rebase_due_key" "$ci_red_head" \
        > "${slot}/${MUGGLE_PR_WATCH_DUE_FILE}"
}
