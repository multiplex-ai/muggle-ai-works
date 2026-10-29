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
# A first arm takes its floors from the drain's own read rather than from a fresh
# fetch afterwards: anything that lands between the two would otherwise be marked
# seen without ever being reported. A re-arm keeps the review, comment and thread
# floors the session already holds, for the same reason.
#
# A stale branch or a red head is floored only when the slot proves a cycle ran
# for it. Flooring whatever was outstanding at arm time let a session that never
# rebased or fixed anything re-arm at every rollover and silence the loop each
# time; the drain line said "handled" and nothing checked.
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

for lib in pr-watch-guards.sh pr-watch-events.sh pr-watch-fetch.sh pr-watch-due.sh pr-watch-floors.sh; do
    if [ ! -f "${script_dir}/${lib}" ]; then
        echo "pr-watch-arm: missing ${lib} beside this script" >&2
        exit 2
    fi
    # shellcheck source=/dev/null
    . "${script_dir}/${lib}"
done

for companion in pr-watch-state.jq pr-watch-verdict.mjs; do
    if [ ! -f "${script_dir}/${companion}" ]; then
        echo "pr-watch-arm: missing ${companion} beside this script" >&2
        exit 2
    fi
done
state_projection="$(cat "${script_dir}/pr-watch-state.jq")"

mkdir -p "$slot"

pinned_token="$(gh auth token 2>/dev/null)"
[ -n "$pinned_token" ] && export GH_TOKEN="$pinned_token"

state_line="$(watch_fetch_state "$repo" "$pr_number" "$slot" "$state_projection")"
if [ -z "$state_line" ]; then
    echo "ARM-FAIL pr=$pr_number could not read PR state — refusing to arm a watch with no floors"
    exit 1
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

if [ "$pr_state" = "MERGED" ] || [ "$pr_state" = "CLOSED" ]; then
    echo "TERMINAL pr=$pr_number state=$pr_state — nothing to arm"
    exit 0
fi

ci_red_head=""
watch_checks_settled_red "$pending_checks" "$failed_checks" && ci_red_head="$head_sha"

# Keyed on the head/base-tip pair, so it re-arms when either moves.
rebase_key="${head_sha}..${base_tip_sha}"
rebase_due_key=""
behind_count="$(watch_fetch_behind_count "$repo" "$base_branch" "$head_sha" "$slot")"
watch_branch_needs_rebase "$mergeable" "$behind_count" && rebase_due_key="$rebase_key"

# Whether a cycle already ran for this key and this head, and the blocked
# fingerprint's digest. A slot re-armed while blocked keeps its resume probe
# live: empty is the not-blocked state, so seeding it empty would leave the loop
# asleep through the very CI move the block is waiting on.
#
# The verdict script rather than sed or jq: the fields sit under a per-PR key,
# jq is not guaranteed present, and a malformed file must read as nothing
# recorded rather than yield a partial match. The file goes in on stdin because
# Windows node cannot open the POSIX path Git Bash hands it. Any failure leaves
# every floor empty, which wakes the loop rather than silencing it.
last_seen_file="${slot}/last_seen.json"
[ -f "$last_seen_file" ] || last_seen_file=/dev/null
rebase_attempted=0
ci_attempted=0
blocked_digest_floor=""
rebase_budget_exhausted=0
while IFS= read -r evidence_line; do
    evidence_line="${evidence_line%$'\r'}"
    case "$evidence_line" in
        REBASE_ATTEMPTED=*) rebase_attempted="${evidence_line#REBASE_ATTEMPTED=}" ;;
        CI_ATTEMPTED=*) ci_attempted="${evidence_line#CI_ATTEMPTED=}" ;;
        BLOCKED_CIDIGEST=*) blocked_digest_floor="${evidence_line#BLOCKED_CIDIGEST=}" ;;
        REBASE_BUDGET_EXHAUSTED=*) rebase_budget_exhausted="${evidence_line#REBASE_BUDGET_EXHAUSTED=}" ;;
    esac
done < <(node "${script_dir}/pr-watch-verdict.mjs" arm-floors --pr-key "${repo}#${pr_number}" \
    --head "$head_sha" --rebase-key "$rebase_key" < "$last_seen_file" 2>/dev/null)

ci_red_floor=""
[ -n "$ci_red_head" ] && [ "$ci_attempted" = "1" ] && ci_red_floor="$ci_red_head"
rebase_floor=""
[ -n "$rebase_due_key" ] && [ "$rebase_attempted" = "1" ] && rebase_floor="$rebase_due_key"

# A PR that spent its catch-up rebase budget is held for its owner whether or not
# the branch is stale yet: the tick refuses every rebase until maxCatchUpRebases
# is raised, so announcing one — here or on the loop's next base move — only asks
# the session for work the verdict turns down. The next arm reads a raised cap.
rebase_held=""
[ "$rebase_budget_exhausted" = "1" ] && rebase_held="1"
recorded_rebase_due_key="$rebase_due_key"
[ -n "$rebase_held" ] && recorded_rebase_due_key=""

thread_count=0
[ -n "$unresolved_threads" ] && thread_count=$(printf '%s' "$unresolved_threads" | tr ';' '\n' | grep -c .)

# A record of the PR as armed, read from the watch's output when its loop ends.
# Printing wakes nobody: the session hears the watch only when the loop exits.
# Unattempted work is left unfloored, so the loop's first poll reports it and
# exits — that report is the wake.
echo "DRAIN pr=$pr_number state=$pr_state head=${head_sha:0:8}"
echo "DRAIN unresolved-threads=$thread_count latest-review=${latest_review:-0} latest-comment=${latest_comment:-0}"
echo "DRAIN checks pending=${pending_checks:-0} failed=${failed_checks:-0} behind-base=${behind_count:-unknown} mergeable=${mergeable:-UNKNOWN}"
if [ -n "$ci_red_head" ]; then
    if [ -n "$ci_red_floor" ]; then
        echo "DRAIN ci red at arm time — a fix-ci cycle already ran for head ${head_sha:0:8}, floored"
    else
        echo "DRAIN ci red at arm time — no fix-ci attempt recorded for head ${head_sha:0:8}, not floored: dispatch fix-ci"
    fi
fi
if [ -n "$rebase_due_key" ]; then
    if [ -n "$rebase_held" ]; then
        echo "DRAIN branch stale at arm time — catch-up rebase budget spent (maxCatchUpRebases), held for the owner: no rebase to dispatch"
    elif [ -n "$rebase_floor" ]; then
        echo "DRAIN branch stale at arm time — a rebase already ran for key ${rebase_due_key}, floored"
    else
        echo "DRAIN branch stale at arm time — no rebase attempt recorded for key ${rebase_due_key}, not floored: dispatch rebase"
    fi
fi

# A re-arm carries the review, comment and thread floors forward. The session
# advanced them past what it handled, so anything newer — a review landing
# between its last tick's read and this one — is above them, and the loop's
# first poll reports it. Seeding them from this read would floor that review
# unseen. Only a first arm, with nothing handled yet, takes them from its read.
review_floor="${latest_review:-0}"
comment_floor="${latest_comment:-0}"
threads_floor="$unresolved_threads"
if [ -f "${slot}/watch-watermark.env" ]; then
    review_floor="$(watch_read_slot_value "$slot" watch-watermark.env REV)"
    comment_floor="$(watch_read_slot_value "$slot" watch-watermark.env COM)"
    threads_floor="$(watch_threads_still_unresolved \
        "$(watch_read_slot_value "$slot" watch-watermark.env THREADS)" "$unresolved_threads")"
fi

{
    printf 'REV=%s\n' "${review_floor:-0}"
    printf 'COM=%s\n' "${comment_floor:-0}"
    printf 'THREADS="%s"\n' "$threads_floor"
    printf 'CIRED="%s"\n' "$ci_red_floor"
    printf 'REBASED="%s"\n' "$rebase_floor"
    printf 'BLOCKED_CIDIGEST="%s"\n' "$blocked_digest_floor"
    printf 'REBASE_HELD="%s"\n' "$rebase_held"
} > "${slot}/watch-watermark.env"

watch_record_due_work "$slot" "$head_sha" "$recorded_rebase_due_key" "$ci_red_head"

# Claim the slot for this session. watcher_lease_is_foreign reads an absent
# owner.json as "not foreign", so a slot armed without one leases itself to a
# live PID nothing can classify: once the arming session dies its watcher polls
# into a closed pipe, and every later arm skips the slot as already owned until
# the loop's monitor window ends it. An unset id writes nothing rather than a placeholder
# — reconcile reads any id it does not recognise as another session's claim, and
# a bogus one would strand the slot exactly as an absent file does.
if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then
    claimed_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '{\n  "session_id": "%s",\n  "claimed_at": "%s"\n}\n' \
        "$CLAUDE_CODE_SESSION_ID" "$claimed_at" > "${slot}/owner.json"
    # Register the slot with the muggle watch service, which resumes this owner
    # in the background if the loop dies while the session is down, so its own
    # reconcile re-arms the watch. It lives in the slot, so a stop rename or a
    # finalize retires it with no extra call; an unowned slot has nobody to resume.
    printf '{\n  "registered_at": "%s",\n  "registered_by": "pr-watch-arm"\n}\n' \
        "$claimed_at" > "${slot}/watch-registration.json"
else
    echo "pr-watch-arm: CLAUDE_CODE_SESSION_ID unset — slot left unowned, reconcile cannot re-arm it" >&2
fi

echo "ARMED pr=$pr_number watermark seeded at ${slot}/watch-watermark.env"

[ "$exec_loop" -eq 1 ] || exit 0

exec bash "${script_dir}/pr-watch-loop.sh" --slot "$slot" --repo "$repo" --pr "$pr_number" --base "$base_branch"
