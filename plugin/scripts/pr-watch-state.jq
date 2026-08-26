# Projects one PR's GraphQL snapshot into the tab-separated state line the watch
# loop compares against its floors. Lives in its own file so it can be exercised
# directly against fixtures — embedded in the loop it was unreachable by tests,
# which is how the echo wake below survived unnoticed.
#
# Field order is the contract pr-watch-loop.sh reads positionally:
#   state, headRefOid, baseRefOid, mergeable, latest-review, latest-comment,
#   unresolved-thread-ids, pending-checks, failed-checks, check-digest

def loop_marked: ((.body // "") | contains("<!-- muggle-do:bot -->"));

.data.repository.pullRequest as $pr
| (($pr.commits.nodes[0].commit.statusCheckRollup.contexts.nodes) // []) as $contexts
| ($contexts | map(
    if .__typename == "CheckRun"
    then {name: .name, verdict: (if .status != "COMPLETED" then "PENDING" else (.conclusion // "NEUTRAL") end)}
    else {name: .context, verdict: (.state // "PENDING")}
    end)) as $checks

# Every comment on a live thread that belongs to a submitted review. A PENDING
# review is the reviewer's own draft and is not feedback yet.
| [$pr.reviewThreads.nodes[]
   | select(.isResolved == false)
   | .comments.nodes[]
   | select((.pullRequestReview.state // "SUBMITTED") != "PENDING")] as $liveComments

# Posting a threaded reply also mints a review envelope around it. That envelope
# is the loop's own echo: without excluding it the loop wakes itself every time
# it answers a comment, and the tick it triggers can only idle.
| ($liveComments | map(select(loop_marked) | .pullRequestReview.databaseId | values)) as $loopOwnedReviews
| ($liveComments | map(select(loop_marked | not) | .pullRequestReview.databaseId | values)) as $humanOwnedReviews
# `index` evaluates its argument against the array it is indexing, so the review
# has to be bound before either membership test can name its id.
| def is_echo_review:
    . as $review
    | ((($review.body // "") == "") or ($review | loop_marked))
      and (($loopOwnedReviews | index($review.databaseId)) != null)
      and (($humanOwnedReviews | index($review.databaseId)) == null);

[
  $pr.state,
  $pr.headRefOid,
  $pr.baseRefOid,
  $pr.mergeable,
  (([$pr.reviews.nodes[] | select(is_echo_review | not) | .databaseId] | max) // 0),
  (($liveComments | map(select(loop_marked | not) | .databaseId) | max) // 0),
  ([$pr.reviewThreads.nodes[] | select(.isResolved == false) | select(.isOutdated == false)
    | select((.comments.nodes[0].pullRequestReview.state // "SUBMITTED") != "PENDING") | .id] | join(";")),
  ($checks | map(select(.verdict == "PENDING")) | length),
  ($checks | map(select(.verdict == "FAILURE" or .verdict == "ERROR" or .verdict == "TIMED_OUT" or .verdict == "STARTUP_FAILURE")) | length),
  ($checks | sort_by(.name) | map(.name + ":" + .verdict) | join(","))
] | @tsv
