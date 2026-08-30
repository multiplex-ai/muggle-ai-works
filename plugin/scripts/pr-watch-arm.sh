#!/usr/bin/env bash
# Arm the watch on one pull request: read its state once, report what is already
# outstanding, seed the watermark from that same read, and start the loop.
#
# Arming used to be three prose steps a caller performed by hand, and skipping
# the middle one — writing watch-watermark.env — produced a loop that held its
# PID lease and touched its heartbeat while polling nothing, reporting nothing
# and never reaching its terminal check. Every health signal said fine. Doing
# the three steps here, in one command, is what makes that unskippable.
#
# The floors are taken from the drain's own read rather than from a fresh fetch
# afterwards: anything that lands between the two would otherwise be marked seen
# without ever being reported.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

slot="" repo="" pr_number="" base_branch="" exec_loop=1

while [ $# -gt 0 ]; do
    case "$1" in
        --slot) slot="$2"; shift 2 ;;
        --repo) repo="$2"; shift 2 ;;
        --pr) pr_number="$2"; shift 2 ;;
        --base) base_branch="$2"; shift 2 ;;
        --no-exec) exec_loop=0; shift ;;
        *) echo "pr-watch-arm: unknown argument $1" >&2; exit 2 ;;
    esac
done

if [ -z "$slot" ] || [ -z "$repo" ] || [ -z "$pr_number" ] || [ -z "$base_branch" ]; then
    echo "usage: pr-watch-arm.sh --slot <dir> --repo <owner/repo> --pr <n> --base <branch> [--no-exec]" >&2
    exit 2
fi

for lib in pr-watch-guards.sh pr-watch-events.sh pr-watch-fetch.sh; do
    if [ ! -f "${script_dir}/${lib}" ]; then
        echo "pr-watch-arm: missing ${lib} beside this script" >&2
        exit 2
    fi
    # shellcheck source=/dev/null
    . "${script_dir}/${lib}"
done

if [ ! -f "${script_dir}/pr-watch-state.jq" ]; then
    echo "pr-watch-arm: missing pr-watch-state.jq beside this script" >&2
    exit 2
fi
state_projection="$(cat "${script_dir}/pr-watch-state.jq")"

mkdir -p "$slot"

pinned_token="$(gh auth token 2>/dev/null)"
[ -n "$pinned_token" ] && export GH_TOKEN="$pinned_token"

state_line="$(watch_fetch_state "$repo" "$pr_number" "$slot" "$state_projection")"
if [ -z "$state_line" ]; then
    echo "ARM-FAIL pr=$pr_number could not read PR state — refusing to arm a watch with no floors"
    exit 1
fi

mapfile -t fields < <(watch_split_state "$state_line")
pr_state="${fields[0]-}"
head_sha="${fields[1]-}"
base_sha="${fields[2]-}"
mergeable="${fields[3]-}"
latest_review="${fields[4]-}"
latest_comment="${fields[5]-}"
unresolved_threads="${fields[6]-}"
pending_checks="${fields[7]-}"
failed_checks="${fields[8]-}"

if [ "$pr_state" = "MERGED" ] || [ "$pr_state" = "CLOSED" ]; then
    echo "TERMINAL pr=$pr_number state=$pr_state — nothing to arm"
    exit 0
fi

# A red head at arm time is the drain's to hand over, so it goes into the floor
# and does not re-fire on the loop's first pass. Pending checks are not red yet.
ci_red_floor=""
if [ "${pending_checks:-0}" -eq 0 ] 2>/dev/null && [ "${failed_checks:-0}" -gt 0 ] 2>/dev/null; then
    ci_red_floor="$head_sha"
fi

# Same for staleness: keyed on the head/base pair, so it re-arms when either moves.
rebase_floor=""
behind_count="$(watch_fetch_behind_count "$repo" "$base_branch" "$head_sha" "$slot")"
if [ "$mergeable" = "CONFLICTING" ] || { [ -n "$behind_count" ] && [ "$behind_count" -gt 0 ] 2>/dev/null; }; then
    rebase_floor="${head_sha}..${base_sha}"
fi

thread_count=0
[ -n "$unresolved_threads" ] && thread_count=$(printf '%s' "$unresolved_threads" | tr ';' '\n' | grep -c .)

# Printed, not swallowed: these are the things the arming session owes a decision
# on before the monitor takes over, and the monitor only ever sees what arrives
# after this point.
echo "DRAIN pr=$pr_number state=$pr_state head=${head_sha:0:8}"
echo "DRAIN unresolved-threads=$thread_count latest-review=${latest_review:-0} latest-comment=${latest_comment:-0}"
echo "DRAIN checks pending=${pending_checks:-0} failed=${failed_checks:-0} behind-base=${behind_count:-unknown} mergeable=${mergeable:-UNKNOWN}"
[ -n "$ci_red_floor" ] && echo "DRAIN ci already red at arm time — handled by the arming session, floored"
[ -n "$rebase_floor" ] && echo "DRAIN branch already stale at arm time — handled by the arming session, floored"

{
    printf 'REV=%s\n' "${latest_review:-0}"
    printf 'COM=%s\n' "${latest_comment:-0}"
    printf 'THREADS="%s"\n' "$unresolved_threads"
    printf 'CIRED="%s"\n' "$ci_red_floor"
    printf 'REBASED="%s"\n' "$rebase_floor"
    printf 'BLOCKED_CIDIGEST=""\n'
} > "${slot}/watch-watermark.env"

echo "ARMED pr=$pr_number watermark seeded at ${slot}/watch-watermark.env"

[ "$exec_loop" -eq 1 ] || exit 0

exec bash "${script_dir}/pr-watch-loop.sh" --slot "$slot" --repo "$repo" --pr "$pr_number" --base "$base_branch"
