# Projects one PR's GraphQL snapshot into the tab-separated state line the watch
# loop compares against its floors. Lives in its own file so it can be exercised
# directly against fixtures — embedded in the loop it was unreachable by tests,
# which is how the echo wake below survived unnoticed.
#
# Field order is the contract pr-watch-loop.sh reads positionally:
#   state, headRefOid, base-tip, mergeable, latest-review, latest-comment,
#   unresolved-thread-ids, pending-checks, failed-checks, check-digest,
#   red-check-runs, latest-conversation-comment, body-only-review-ids,
#   conversation-comment-ids, unanswered-thread-comments
#
# red-check-runs names each failed check with its run id (`name#id`, sorted).
# A settle, a rerun or a comment-triggered re-check publishes a new run on the
# same head, so this is what tells a fresh red verdict from the one already
# reported. check-digest cannot carry the ids: it must equal the digest the
# blocked tick builds from `gh pr checks`, which has none.
#
# base-tip is where the base branch points now, the base half of the rebase key.
# Not baseRefOid: GitHub moves that only when the head is pushed, so a key built
# from it stays equal to an escalated or floored key however far the base
# advances, and the branch never wakes again. A deleted base branch projects as
# an empty field rather than a missing one, so no later field shifts.
#
# latest-conversation-comment is the newest top-level PR comment (the
# Conversation tab) a human wrote.
#
# The last three fields list, rather than take the maximum of, the feedback the
# arm step checks against what last_seen.json records as handled: one escalated
# id above the handled watermark must not hide an unhandled one below it.
#   body-only-review-ids — submitted reviews with a body and no line comments,
#     comma-joined: the reviews the tick dispatches against lastBodyReviewId.
#   conversation-comment-ids — the ids latest-conversation-comment ranges over.
#   unanswered-thread-comments — `<newest-comment-id>:<owning-review-id>` for
#     each unresolved thread, outdated or not, whose newest comment muggle did
#     not post: the threads the tick finds actionable.
# Appended after every earlier field, so each earlier reader keeps its index.

def loop_marked: ((.body // "") | contains("<!-- muggle-do:bot -->"));

# A body without its `>` quote lines. GitHub's quote-reply copies the quoted
# text's markdown, so a human answering one of muggle's posts carries muggle's
# visible signature inside the quote.
def unquoted_body: (.body // "") | split("\n") | map(select(test("^ *>") | not)) | join("\n");

# Anything muggle posts on the Conversation tab: loop replies and reminders,
# walkthrough and PR sections (each opens with a `<!-- muggle-` marker), and
# plain-signed notices, which carry only the visible signature link.
def muggle_posted:
    loop_marked
    or (unquoted_body | contains("<!-- muggle-"))
    or (unquoted_body | contains("[Muggle Works](https://github.com/multiplex-ai/muggle-ai-works)"));

# GraphQL names a GitHub App by its bare login (`github-actions`) and types it
# Bot; the `[bot]` suffix is the REST spelling, kept for any author that has it.
def bot_authored:
    (.author.__typename // "") == "Bot"
    or ((.author.login // "") | endswith("[bot]"))
    or (.author.login // "") == "github-actions";

.data.repository.pullRequest as $pr
| (($pr.commits.nodes[0].commit.statusCheckRollup.contexts.nodes) // []) as $contexts
| ($contexts | map(
    if .__typename == "CheckRun"
    then {name: .name, runId: (.databaseId // ""), verdict: (if .status != "COMPLETED" then "PENDING" else (.conclusion // "NEUTRAL") end)}
    else {name: .context, runId: "", verdict: (.state // "PENDING")}
    end)) as $checks
| ($checks | map(select(.verdict == "FAILURE" or .verdict == "ERROR" or .verdict == "TIMED_OUT" or .verdict == "STARTUP_FAILURE")))
    as $failedChecks

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
| def is_body_only_review:
    ((.comments.totalCount // 0) == 0)
    and ((.state // "") != "DISMISSED")
    and ((.body // "") | test("\\S"))
    and (muggle_posted | not);
# `index` evaluates its argument against the array it is indexing, so the review
# has to be bound before either membership test can name its id.
  def is_echo_review:
    . as $review
    | ((($review.body // "") == "") or ($review | loop_marked))
      and (($loopOwnedReviews | index($review.databaseId)) != null)
      and (($humanOwnedReviews | index($review.databaseId)) == null);

  (($pr.comments.nodes // []) | map(select((muggle_posted | not) and (bot_authored | not)) | .databaseId))
    as $humanConversationIds

| [
  $pr.state,
  $pr.headRefOid,
  ($pr.baseRef.target.oid // ""),
  $pr.mergeable,
  (([$pr.reviews.nodes[] | select(is_echo_review | not) | .databaseId] | max) // 0),
  (($liveComments | map(select(loop_marked | not) | .databaseId) | max) // 0),
  ([$pr.reviewThreads.nodes[] | select(.isResolved == false) | select(.isOutdated == false)
    | select((.comments.nodes[0].pullRequestReview.state // "SUBMITTED") != "PENDING") | .id] | join(";")),
  ($checks | map(select(.verdict == "PENDING")) | length),
  ($failedChecks | length),
  ($checks | sort_by(.name) | map(.name + ":" + .verdict) | join(",")),
  ($failedChecks | map(.name + "#" + (.runId | tostring)) | sort | join(",")),
  ($humanConversationIds | max // 0),
  ([$pr.reviews.nodes[] | select(is_body_only_review) | .databaseId] | sort | map(tostring) | join(",")),
  ($humanConversationIds | sort | map(tostring) | join(",")),
  ([$pr.reviewThreads.nodes[] | select(.isResolved == false) | .comments.nodes[-1] // empty
    | select((.pullRequestReview.state // "SUBMITTED") != "PENDING") | select(muggle_posted | not)
    | "\(.databaseId):\(.pullRequestReview.databaseId // "")"] | join(","))
] | @tsv
