#!/usr/bin/env bash

# Deterministic detector for the muggle-pr-followup watcher, run under the
# harness Monitor tool. Every stdout line becomes a turn in the session that
# armed the watcher, so a quiet iteration prints nothing at all — that silence
# is the whole point. Detection mirrors contract.md Steps 2-6; deciding what to
# do about an emitted line stays with the escalation turn.
#
# No `set -e`: one failed `gh` call must never kill a session-length poller.

set -uo pipefail

readonly LOOP_MARKER='<!-- muggle-do:bot -->'
readonly POLL_INTERVAL_CEILING_SECONDS=60
readonly CI_FIX_ATTEMPT_CAP=3
readonly REBASE_ATTEMPT_CAP=2
# A wedged network or a revoked token fails every iteration; repeating the ERROR
# each minute would trip Monitor's noisy-monitor auto-stop and take the whole
# watcher down with it.
readonly ERROR_REPEAT_EVERY_FAILURES=10

slug=""
repo=""
number=""

while [ $# -gt 0 ]; do
    case "$1" in
        --slug) slug="${2:-}"; shift 2 ;;
        --repo) repo="${2:-}"; shift 2 ;;
        --number) number="${2:-}"; shift 2 ;;
        *) printf 'MUGGLE-WATCH %s ERROR unknown argument %s\n' "${slug:-?}" "$1"; exit 2 ;;
    esac
done

emit() {
    printf 'MUGGLE-WATCH %s %s\n' "$slug" "$*"
}

# Reconcile decides a watcher died from the age of the newest followup.log line,
# so a silent poller still has to leave a heartbeat — otherwise the sweep would
# re-arm a cron watcher on top of a healthy Monitor one.
log_tick() {
    [ -d "$slot_dir" ] || return 0
    printf '%s poll pr=%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$number" "$*" >> "$followup_log" 2>/dev/null || true
}

if [ -z "$slug" ] || [ -z "$repo" ] || [ -z "$number" ]; then
    printf 'MUGGLE-WATCH %s ERROR usage: poll.sh --slug <slug> --repo <owner>/<repo> --number <n>\n' "${slug:-?}"
    exit 2
fi

for required_tool in gh jq; do
    if ! command -v "$required_tool" >/dev/null 2>&1; then
        emit "ERROR required tool not found: $required_tool"
        exit 1
    fi
done

owner="${repo%%/*}"
repo_name="${repo##*/}"
slot_dir="${HOME}/.muggle-ai/muggle-do/sessions/${slug}"
last_seen_file="${slot_dir}/last_seen.json"
followup_log="${slot_dir}/followup.log"
pr_key="${repo}#${number}"

if [ ! -d "$slot_dir" ]; then
    emit "ERROR no session slot at $slot_dir"
    exit 1
fi

poll_interval_seconds="$POLL_INTERVAL_CEILING_SECONDS"
# Test seam. Clamped to the ceiling so it can only shorten the wait — the 60s
# cadence is a product decision, not a tuning knob.
if [ -n "${MUGGLE_POLL_TEST_INTERVAL_SECONDS:-}" ]; then
    case "$MUGGLE_POLL_TEST_INTERVAL_SECONDS" in
        ''|*[!0-9]*) ;;
        *) [ "$MUGGLE_POLL_TEST_INTERVAL_SECONDS" -lt "$POLL_INTERVAL_CEILING_SECONDS" ] \
               && poll_interval_seconds="$MUGGLE_POLL_TEST_INTERVAL_SECONDS" ;;
    esac
fi
max_iterations="${MUGGLE_POLL_TEST_MAX_ITERATIONS:-0}"

load_last_seen_entry() {
    local loaded
    if [ -f "$last_seen_file" ] && loaded=$(jq -c --arg key "$pr_key" '.[$key] // {}' "$last_seen_file" 2>/dev/null); then
        printf '%s' "$loaded"
    else
        printf '{}'
    fi
}

# Whole-file rewrite through a temp file and an atomic rename. An in-place edit
# of session JSON silently drops updates, and the escalation turn writes this
# same file — so re-read at write time to keep the read/write window minimal and
# preserve every field this poller does not own.
write_idle_tick_count() {
    local next_count="$1" temp_file
    [ -f "$last_seen_file" ] || return 0
    temp_file=$(mktemp "${last_seen_file}.XXXXXX" 2>/dev/null) || return 0
    if jq --arg key "$pr_key" --argjson count "$next_count" \
        '.[$key] = ((.[$key] // {}) + { idle_tick_count: $count })' \
        "$last_seen_file" > "$temp_file" 2>/dev/null; then
        mv -f "$temp_file" "$last_seen_file" 2>/dev/null || rm -f "$temp_file"
    else
        rm -f "$temp_file"
    fi
}

entry_field() {
    jq -r "$1" <<<"$last_seen_entry" 2>/dev/null || printf '%s' "$2"
}

fetch_pr_metadata() {
    gh pr view "$number" --repo "$repo" \
        --json url,number,headRefOid,headRefName,baseRefName,state,mergeable,mergeStateStatus 2>/dev/null
}

fetch_review_threads() {
    gh api graphql -F owner="$owner" -F name="$repo_name" -F number="$number" -f query='
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first: 100) {
            nodes {
              databaseId
              pullRequestReview { databaseId }
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}' 2>/dev/null
}

fetch_submitted_reviews() {
    gh api "repos/${repo}/pulls/${number}/reviews" --paginate 2>/dev/null
}

fetch_review_line_comments() {
    gh api "repos/${repo}/pulls/${number}/reviews/${1}/comments" 2>/dev/null
}

fetch_compare() {
    gh api "repos/${repo}/compare/${1}...${2}" 2>/dev/null
}

# `gh pr checks` exits non-zero whenever a check is red, so its status says
# nothing about whether the call worked — take the output either way.
fetch_pr_checks() {
    gh pr checks "$number" --repo "$repo" --json name,state,bucket,link 2>/dev/null || true
}

# A thread is actionable when it is unresolved, not outdated, and its newest
# comment lacks the loop marker. Classify by the marker, never by author login:
# under a shared account the loop posts as the PR author.
actionable_thread_review_ids() {
    jq -r --arg marker "$LOOP_MARKER" '
      [ .data.repository.pullRequest.reviewThreads.nodes[]?
        | select(.isResolved == false and .isOutdated == false)
        | ((.comments.nodes // []) | sort_by(.createdAt) | last) as $newest
        | select($newest != null)
        | select((($newest.body // "") | contains($marker)) | not)
        | $newest.pullRequestReview.databaseId
      ] | map(select(. != null)) | unique | .[]
    ' <<<"$1" 2>/dev/null
}

body_only_review_candidate_ids() {
    local reviews_json="$1" watermark="$2" escalated="$3"
    jq -r --argjson watermark "$watermark" --argjson escalated "$escalated" '
      [ .[]?
        | select(.submitted_at != null)
        | select(.state == "CHANGES_REQUESTED"
                 or .state == "COMMENTED"
                 or (.state == "APPROVED" and (((.body // "") | length) > 0)))
        | select(.id > $watermark)
        | select(. as $review | ($escalated | index($review.id)) == null)
        | .id
      ] | unique | .[]
    ' <<<"$reviews_json" 2>/dev/null
}

consecutive_failures=0
last_emitted_signature=""
iteration=0

report_failure() {
    consecutive_failures=$((consecutive_failures + 1))
    if [ "$consecutive_failures" -eq 1 ] \
        || [ $((consecutive_failures % ERROR_REPEAT_EVERY_FAILURES)) -eq 0 ]; then
        emit "ERROR $1 (consecutive failures: $consecutive_failures)"
    fi
}

# Suppress a repeat of the state we already reported: the escalation turn has
# it, and re-emitting each minute would burn a turn per minute. The signature
# moves the moment the underlying state does (new review, new head, new base),
# which re-arms the emit.
emit_once() {
    local signature="$1"
    shift
    [ "$signature" = "$last_emitted_signature" ] && return 1
    last_emitted_signature="$signature"
    emit "$@"
    return 0
}

while true; do
    iteration=$((iteration + 1))

    last_seen_entry=$(load_last_seen_entry)

    metadata=$(fetch_pr_metadata)
    if [ -z "$metadata" ]; then
        report_failure "pr metadata fetch failed for ${repo}#${number}"
    else
        pr_state=$(jq -r '.state // ""' <<<"$metadata" 2>/dev/null)
        head_sha=$(jq -r '.headRefOid // ""' <<<"$metadata" 2>/dev/null)
        base_ref=$(jq -r '.baseRefName // ""' <<<"$metadata" 2>/dev/null)
        mergeable=$(jq -r '.mergeable // ""' <<<"$metadata" 2>/dev/null)

        if [ -z "$pr_state" ] || [ -z "$head_sha" ]; then
            report_failure "pr metadata unparseable for ${repo}#${number}"
        else
            consecutive_failures=0

            case "$pr_state" in
                MERGED)
                    log_tick "emit=TERMINAL merged"
                    emit "TERMINAL merged"
                    exit 0
                    ;;
                CLOSED)
                    log_tick "emit=TERMINAL closed"
                    emit "TERMINAL closed"
                    exit 0
                    ;;
            esac

            dispatch_ids=""

            threads_json=$(fetch_review_threads)
            if [ -n "$threads_json" ]; then
                while read -r review_id; do
                    [ -n "$review_id" ] && dispatch_ids="${dispatch_ids} ${review_id}"
                done <<<"$(actionable_thread_review_ids "$threads_json")"
            fi

            watermark=$(entry_field '.lastBodyReviewId // 0' 0)
            case "$watermark" in ''|*[!0-9]*) watermark=0 ;; esac
            escalated_review_ids=$(entry_field '(.escalated_review_ids // []) | tojson' '[]')
            [ -n "$escalated_review_ids" ] || escalated_review_ids='[]'

            reviews_json=$(fetch_submitted_reviews)
            if [ -n "$reviews_json" ]; then
                while read -r candidate_id; do
                    [ -n "$candidate_id" ] || continue
                    # A review carrying line comments is dispatched from thread
                    # state above; only a bodied review with none is body-only.
                    line_comments=$(fetch_review_line_comments "$candidate_id") || continue
                    [ -n "$line_comments" ] || continue
                    comment_count=$(jq -r 'length' <<<"$line_comments" 2>/dev/null) || continue
                    [ "$comment_count" = "0" ] && dispatch_ids="${dispatch_ids} ${candidate_id}"
                done <<<"$(body_only_review_candidate_ids "$reviews_json" "$watermark" "$escalated_review_ids")"
            fi

            dispatch_ids=$(printf '%s\n' $dispatch_ids | sort -u | tr '\n' ' ')
            dispatch_ids="${dispatch_ids# }"
            dispatch_ids="${dispatch_ids% }"

            # Reviews preempt everything else (contract.md Step 4): when there is
            # feedback outstanding, this iteration never looks at rebase or CI.
            if [ -n "$dispatch_ids" ]; then
                if emit_once "REVIEWS:${dispatch_ids}" "REVIEWS ${dispatch_ids}"; then
                    log_tick "emit=REVIEWS ids=${dispatch_ids}"
                    write_idle_tick_count 0
                else
                    log_tick "held=REVIEWS ids=${dispatch_ids}"
                fi
            else
                acted=0

                base_tip_sha=""
                behind_by=0
                if [ -n "$base_ref" ]; then
                    compare_json=$(fetch_compare "$base_ref" "$head_sha")
                    if [ -n "$compare_json" ]; then
                        behind_by=$(jq -r '.behind_by // 0' <<<"$compare_json" 2>/dev/null)
                        base_tip_sha=$(jq -r '.base_commit.sha // ""' <<<"$compare_json" 2>/dev/null)
                    fi
                fi
                case "$behind_by" in ''|*[!0-9]*) behind_by=0 ;; esac

                rebase_due=0
                [ "$behind_by" -gt 0 ] && rebase_due=1
                [ "$mergeable" = "CONFLICTING" ] && rebase_due=1

                if [ "$rebase_due" -eq 1 ] && [ -n "$base_tip_sha" ]; then
                    rebase_key="${head_sha}..${base_tip_sha}"
                    rebase_attempts=$(entry_field "(.conflict_resolve_attempts // {})[\"${rebase_key}\"] // 0" 0)
                    case "$rebase_attempts" in ''|*[!0-9]*) rebase_attempts=0 ;; esac
                    rebase_escalated=$(entry_field "if ((.conflict_escalated_keys // []) | index(\"${rebase_key}\")) then \"yes\" else \"no\" end" "no")
                    if [ "$rebase_attempts" -lt "$REBASE_ATTEMPT_CAP" ] && [ "$rebase_escalated" != "yes" ]; then
                        if emit_once "REBASE:${rebase_key}" "REBASE ${rebase_key}"; then
                            log_tick "emit=REBASE key=${rebase_key}"
                            write_idle_tick_count 0
                        else
                            log_tick "held=REBASE key=${rebase_key}"
                        fi
                        acted=1
                    fi
                fi

                if [ "$acted" -eq 0 ]; then
                    checks_json=$(fetch_pr_checks)
                    red_checks=""
                    pending_checks=0
                    # Empty or unparseable output here means "no checks reported"
                    # — `gh pr checks` says that on stderr and exits non-zero.
                    # A genuine auth or network failure would already have taken
                    # out the metadata fetch above, which does report ERROR.
                    if [ -n "$checks_json" ] && jq -e 'type == "array"' <<<"$checks_json" >/dev/null 2>&1; then
                        pending_checks=$(jq -r '[.[] | select(.bucket == "pending")] | length' <<<"$checks_json" 2>/dev/null)
                        case "$pending_checks" in ''|*[!0-9]*) pending_checks=0 ;; esac
                        red_checks=$(jq -r '[.[] | select(.bucket == "fail") | .name] | join(" | ")' <<<"$checks_json" 2>/dev/null)
                    fi

                    if [ "$pending_checks" -eq 0 ] && [ -n "$red_checks" ]; then
                        ci_attempts=$(entry_field "(.ci_fix_attempts // {})[\"${head_sha}\"] // 0" 0)
                        case "$ci_attempts" in ''|*[!0-9]*) ci_attempts=0 ;; esac
                        ci_escalated=$(entry_field "if ((.ci_escalated_shas // []) | index(\"${head_sha}\")) then \"yes\" else \"no\" end" "no")
                        if [ "$ci_attempts" -lt "$CI_FIX_ATTEMPT_CAP" ] && [ "$ci_escalated" != "yes" ]; then
                            if emit_once "CI:${head_sha}:${red_checks}" "CI ${red_checks}"; then
                                log_tick "emit=CI checks=${red_checks}"
                                write_idle_tick_count 0
                            else
                                log_tick "held=CI checks=${red_checks}"
                            fi
                            acted=1
                        fi
                    fi
                fi

                if [ "$acted" -eq 0 ]; then
                    last_emitted_signature=""
                    idle_tick_count=$(entry_field '.idle_tick_count // 0' 0)
                    case "$idle_tick_count" in ''|*[!0-9]*) idle_tick_count=0 ;; esac
                    write_idle_tick_count $((idle_tick_count + 1))
                    log_tick "idle"
                fi
            fi
        fi
    fi

    if [ "$max_iterations" -gt 0 ] && [ "$iteration" -ge "$max_iterations" ]; then
        exit 0
    fi

    sleep "$poll_interval_seconds"
done
