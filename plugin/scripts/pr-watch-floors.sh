#!/usr/bin/env bash

# The floors a watch compares each poll against, as they persist between loops.
# Sourced by pr-watch-arm.sh and pr-watch-loop.sh.
#
# A loop exits on every report, because the session that owns it hears it only
# when it exits. So no floor can live in a loop's memory: whatever stops one
# occurrence firing twice has to be on disk for the next loop to read. Two files
# hold them — watch-watermark.env, which the session advances past what it
# handled, and watch-reported.env, which the loop advances past what it told
# the session — and a poll fires only on what is above both.

MUGGLE_PR_WATCH_REPORTED_FILE="watch-reported.env"

# Prints the value of `key` in a slot file of `KEY="value"` lines, quotes
# stripped, the last match winning; nothing when the file or key is absent.
# Read with builtins, never sourced: THREADS holds bare semicolons, which a
# sourced unquoted line would split, and a CI digest carries check names an
# author controls.
watch_read_slot_value() {
    local slot="$1" file_name="$2" key="$3" line value=""
    [ -f "${slot}/${file_name}" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            "${key}="*)
                value="${line#"${key}"=}"
                value="${value%\"}"
                value="${value#\"}"
                ;;
        esac
    done < "${slot}/${file_name}"
    printf '%s' "$value"
}

# True when the slot file carries `key` at all, empty or not. Tells a floor
# written as zero from one a watch armed before that floor existed never wrote.
watch_slot_has_key() {
    local slot="$1" file_name="$2" key="$3" line
    [ -f "${slot}/${file_name}" ] || return 1
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            "${key}="*) return 0 ;;
        esac
    done < "${slot}/${file_name}"
    return 1
}

# Writes <slot>/watch-reported.env: the newest review, thread-comment and
# conversation-comment ids and the unresolved threads a loop's last poll saw —
# every one of them either reported or already floored — and the red head,
# rebase key and blocked digest it reported, with the block (`blocked_for`, that
# block's watermark digest) the digest was reported under.
watch_record_reported() {
    local slot="$1" review="$2" comment="$3" conversation="$4" threads="$5" ci_red="$6" rebase="$7" blocked_digest="$8" blocked_for="$9"
    printf 'REV=%s\nCOM=%s\nCONV=%s\nTHREADS="%s"\nCIRED="%s"\nREBASED="%s"\nBLOCKED_CIDIGEST="%s"\nBLOCKED_FOR="%s"\n' \
        "$review" "$comment" "$conversation" "$threads" "$ci_red" "$rebase" "$blocked_digest" "$blocked_for" \
        > "${slot}/${MUGGLE_PR_WATCH_REPORTED_FILE}"
}

# Prints the threads of `known` (semicolon-joined) that are still in
# `unresolved`, semicolon-joined. A thread resolved since it was floored drops
# out, so its unresolving again is news.
watch_threads_still_unresolved() {
    local known="$1" unresolved="$2" thread_id kept=""
    local -a thread_ids
    IFS=';' read -ra thread_ids <<< "$known"
    for thread_id in "${thread_ids[@]}"; do
        [ -n "$thread_id" ] || continue
        case ";${unresolved};" in
            *";${thread_id};"*) kept="${kept:+${kept};}${thread_id}" ;;
        esac
    done
    printf '%s' "$kept"
}
