#!/usr/bin/env bash

# Records what the watch itself observed into the local watch quality-of-service
# ledger: the PR armed, a head settled red, the loop giving up. Sourced by
# pr-watch-arm.sh and pr-watch-loop.sh.
#
# The record entry only appends a line to ~/.muggle-ai/telemetry/watch-qos.jsonl;
# the muggle watch service uploads it later. Nothing here reaches the network,
# and a missing entry or a failed write never stops the watch.

# Records one signal for <repo>#<pr>, optionally on a head and for one occurrence.
# Usage: watch_qos_record <signal> <repo> <pr> [head-sha] [occurrence-key]
watch_qos_record() {
    local signal="$1" repo="$2" pr="$3" head="${4-}" occurrence="${5-}"
    local record_entry="${script_dir}/watch-qos-record.mjs"
    [ -f "$record_entry" ] || return 0
    node "$record_entry" --signal "$signal" --detector watch-loop --repo "$repo" --pr "$pr" \
        --head "$head" --occurrence "$occurrence" >/dev/null 2>&1 || true
}
