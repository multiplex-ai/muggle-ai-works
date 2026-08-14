#!/usr/bin/env bash

# The muggle-pr-followup watch loop. One process per PR slot: polls provider
# state, prints one line per new event, and exits when the PR goes terminal.
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
for lib in pr-watch-guards.sh pr-watch-events.sh; do
    [ -f "${script_dir}/${lib}" ] || exit 0
    # shellcheck source=/dev/null
    . "${script_dir}/${lib}"
done

echo "$$" > "${slot}/watch.pid"
started=$(date +%s)
fails=0

# In-memory floors, above the on-disk watermark. The watermark is advanced by
# the session after it handles a wave; these stop the loop re-reporting an event
# in the window before that write lands.
floor_review=0
floor_comment=0
floor_threads=";"
floor_ci_red=""
floor_rebase=""
floor_blocked_digest=""

# Pin the token once: a detached loop can lose access to gh's OS keyring
# mid-run, which surfaces as empty fetches rather than an error.
pinned_token="$(gh auth token 2>/dev/null)"
[ -n "$pinned_token" ] && export GH_TOKEN="$pinned_token"

fetch_pr_state() {
    gh api graphql -F owner="${repo%%/*}" -F name="${repo##*/}" -F number="$pr_number" -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state
      headRefOid
      baseRefOid
      mergeable
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun { name status conclusion }
                  ... on StatusContext { context state }
                }
              }
            }
          }
        }
      }
      reviews(last: 20, states: [COMMENTED, APPROVED, CHANGES_REQUESTED, DISMISSED]) { nodes { databaseId } }
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(last: 1) { nodes { databaseId pullRequestReview { state } } }
        }
      }
    }
  }
}' --jq '
.data.repository.pullRequest as $pr
| (($pr.commits.nodes[0].commit.statusCheckRollup.contexts.nodes) // []) as $contexts
| ($contexts | map(
    if .__typename == "CheckRun"
    then {name: .name, verdict: (if .status != "COMPLETED" then "PENDING" else (.conclusion // "NEUTRAL") end)}
    else {name: .context, verdict: (.state // "PENDING")}
    end)) as $checks
| [
    $pr.state,
    $pr.headRefOid,
    $pr.baseRefOid,
    $pr.mergeable,
    (([$pr.reviews.nodes[].databaseId] | max) // 0),
    (([$pr.reviewThreads.nodes[] | select(.isResolved == false) | .comments.nodes[]
       | select((.pullRequestReview.state // "SUBMITTED") != "PENDING") | .databaseId] | max) // 0),
    ([$pr.reviewThreads.nodes[] | select(.isResolved == false) | select(.isOutdated == false)
      | select((.comments.nodes[0].pullRequestReview.state // "SUBMITTED") != "PENDING") | .id] | join(";")),
    ($checks | map(select(.verdict == "PENDING")) | length),
    ($checks | map(select(.verdict == "FAILURE" or .verdict == "ERROR" or .verdict == "TIMED_OUT" or .verdict == "STARTUP_FAILURE")) | length),
    ($checks | sort_by(.name) | map(.name + ":" + .verdict) | join(","))
  ] | @tsv' 2>>"${slot}/watch-fetch.log"
}

# behind_by needs its own call — see watch_wake_rebase for why no field on the
# PR carries it. Made only when the head/base pair moved, so the steady state
# stays one request per iteration.
fetch_behind_count() {
    local head_sha="$1"
    gh api "repos/${repo}/compare/${base_branch}...${head_sha}" --jq '.behind_by' 2>>"${slot}/watch-fetch.log"
}

read_watermark_value() {
    local key="$1" line value=""
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            "${key}="*)
                value="${line#"${key}"=}"
                value="${value%\"}"
                value="${value#\"}"
                ;;
        esac
    done < "${slot}/watch-watermark.env"
    printf '%s' "$value"
}

while :; do
    watcher_superseded "$slot" "$$" && exit 0
    watcher_lifetime_exceeded "$started" "$(date +%s)" && exit 0
    touch "${slot}/watch-heartbeat" 2>/dev/null

    # No watermark yet means the arming session has not finished seeding. Wait
    # rather than treat every floor as zero, which would fire the whole backlog.
    if [ ! -f "${slot}/watch-watermark.env" ]; then
        sleep "$MUGGLE_PR_WATCH_POLL_INTERVAL"
        continue
    fi

    watermark_review=$(read_watermark_value REV)
    watermark_comment=$(read_watermark_value COM)
    watermark_threads=$(read_watermark_value THREADS)
    watermark_ci_red=$(read_watermark_value CIRED)
    watermark_rebase=$(read_watermark_value REBASED)
    watermark_blocked_digest=$(read_watermark_value BLOCKED_CIDIGEST)

    state_line=$(fetch_pr_state)
    # One quick retry before counting a strike: a single flaky call should not
    # advance the failure budget.
    [ -z "$state_line" ] && { sleep 3; state_line=$(fetch_pr_state); }

    if [ -z "$state_line" ]; then
        fails=$((fails + 1))
        echo "$(date -u +%FT%TZ) fetch empty (${fails}/${MUGGLE_PR_WATCH_MAX_FETCH_FAILURES})" >> "${slot}/watch-fetch.log"
        if [ "$fails" -ge "$MUGGLE_PR_WATCH_MAX_FETCH_FAILURES" ]; then
            echo "WATCH-FAIL pr=$pr_number ${fails} consecutive fetch failures — see watch-fetch.log"
            exit 1
        fi
        sleep "$(watcher_fetch_backoff "$fails")"
        continue
    fi

    mapfile -t state_fields < <(watch_split_state "$state_line")
    pr_state="${state_fields[0]-}"
    head_sha="${state_fields[1]-}"
    base_sha="${state_fields[2]-}"
    mergeable="${state_fields[3]-}"
    latest_review="${state_fields[4]-}"
    latest_comment="${state_fields[5]-}"
    unresolved_threads="${state_fields[6]-}"
    pending_checks="${state_fields[7]-}"
    failed_checks="${state_fields[8]-}"
    ci_digest="${state_fields[9]-}"

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
        sleep "$(watcher_fetch_backoff "$fails")"
        continue
    fi
    fails=0

    if watch_wake_review "$pr_number" "$latest_review" \
        "$(( watermark_review > floor_review ? watermark_review : floor_review ))"; then
        floor_review="$latest_review"
    fi

    if watch_wake_comment "$pr_number" "$latest_comment" \
        "$(( watermark_comment > floor_comment ? watermark_comment : floor_comment ))"; then
        floor_comment="$latest_comment"
    fi

    if [ -n "$unresolved_threads" ]; then
        IFS=';' read -ra thread_ids <<< "$unresolved_threads"
        for thread_id in "${thread_ids[@]}"; do
            if watch_wake_thread "$pr_number" "$thread_id" "${watermark_threads};${floor_threads}"; then
                floor_threads="${floor_threads}${thread_id};"
            fi
        done
    fi

    if watch_wake_ci_red "$pr_number" "$pending_checks" "$failed_checks" "$head_sha" \
        "${floor_ci_red:-$watermark_ci_red}"; then
        floor_ci_red="$head_sha"
    fi

    rebase_key="${head_sha}..${base_sha}"
    if [ "$rebase_key" != "$watermark_rebase" ] && [ "$rebase_key" != "$floor_rebase" ]; then
        behind_count=$(fetch_behind_count "$head_sha")
        if watch_wake_rebase "$pr_number" "$mergeable" "$behind_count" "$rebase_key" ""; then
            floor_rebase="$rebase_key"
        fi
    fi

    # The tick owns clearing the block, and it may not run for a while. Holding
    # the emitted digest stops the loop repeating itself every iteration in the
    # meantime — the repeat nagging the design rules out — while a further move
    # still wakes it.
    if [ "$ci_digest" != "$floor_blocked_digest" ] \
        && watch_wake_blocked_resume "$pr_number" "$ci_digest" "$watermark_blocked_digest"; then
        floor_blocked_digest="$ci_digest"
    fi

    sleep "$MUGGLE_PR_WATCH_POLL_INTERVAL"
done
