import { STATE_LIST_SEPARATOR, THREAD_COMMENT_REVIEW_SEPARATOR } from "./constants.js";
import type { ArmFeedbackObservation, LastSeenPrEntry, UnansweredThreadComment, UnhandledFeedback } from "./types.js";

function parseFeedbackId(text: string): number | undefined {
  const parsed = Number(text.trim());
  return text.trim() !== "" && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** The ids of one comma-joined state projection list; entries that are not positive integers are dropped. */
export function parseFeedbackIdList(listText: string): number[] {
  return listText
    .split(STATE_LIST_SEPARATOR)
    .map(parseFeedbackId)
    .filter((feedbackId): feedbackId is number => feedbackId !== undefined);
}

/** The `<newest-comment-id>:<owning-review-id>` entries of the projection's unanswered-thread list. */
export function parseUnansweredThreadComments(listText: string): UnansweredThreadComment[] {
  const threadComments: UnansweredThreadComment[] = [];
  for (const entry of listText.split(STATE_LIST_SEPARATOR)) {
    const [commentText = "", reviewText = ""] = entry.split(THREAD_COMMENT_REVIEW_SEPARATOR);
    const commentId = parseFeedbackId(commentText);
    if (commentId === undefined) continue;
    threadComments.push({ commentId: commentId, owningReviewId: parseFeedbackId(reviewText) });
  }
  return threadComments;
}

function handledWatermark(recorded: unknown): number | undefined {
  return typeof recorded === "number" && Number.isFinite(recorded) ? recorded : undefined;
}

function floorCeilingBelow(feedbackIds: number[]): number | undefined {
  return feedbackIds.length > 0 ? Math.min(...feedbackIds) - 1 : undefined;
}

const ascendingUnique = (feedbackIds: number[]): number[] => [...new Set(feedbackIds)].sort((left, right) => left - right);

/**
 * The review feedback outstanding at arm time that `last_seen.json` does not record as handled — the actionable set of
 * `muggle-pr-followup/contract.md` Step 3, read from the arm's own fetch.
 *
 * A body-only review counts above `lastBodyReviewId` and a conversation comment above `lastConversationCommentId`,
 * each unless escalated; an entry without the watermark predates it, so that source counts nothing, as the tick seeds
 * it rather than dispatching history. A thread counts while its newest comment is not muggle's and its owning review is
 * not escalated: thread state is its own record, so it needs no watermark.
 */
export function resolveUnhandledFeedback(
  lastSeenEntry: LastSeenPrEntry,
  observation: ArmFeedbackObservation,
): UnhandledFeedback {
  const escalatedReviewIds = new Set(lastSeenEntry.escalated_review_ids ?? []);
  const escalatedConversationIds = new Set(lastSeenEntry.escalated_conversation_comment_ids ?? []);
  const handledBodyReviewId = handledWatermark(lastSeenEntry.lastBodyReviewId);
  const handledConversationId = handledWatermark(lastSeenEntry.lastConversationCommentId);

  const unhandledBodyReviewIds =
    handledBodyReviewId === undefined
      ? []
      : observation.bodyOnlyReviewIds.filter(
          (reviewId) => reviewId > handledBodyReviewId && !escalatedReviewIds.has(reviewId),
        );
  const unansweredThreadComments = observation.unansweredThreadComments.filter(
    (threadComment) =>
      threadComment.owningReviewId === undefined || !escalatedReviewIds.has(threadComment.owningReviewId),
  );
  const unhandledConversationIds =
    handledConversationId === undefined
      ? []
      : observation.conversationCommentIds.filter(
          (commentId) => commentId > handledConversationId && !escalatedConversationIds.has(commentId),
        );

  const threadOwningReviewIds = unansweredThreadComments
    .map((threadComment) => threadComment.owningReviewId)
    .filter((reviewId): reviewId is number => reviewId !== undefined);
  return {
    reviewIds: ascendingUnique([...unhandledBodyReviewIds, ...threadOwningReviewIds]),
    conversationCommentIds: ascendingUnique(unhandledConversationIds),
    reviewFloorCeiling: floorCeilingBelow(unhandledBodyReviewIds),
    commentFloorCeiling: floorCeilingBelow(unansweredThreadComments.map((threadComment) => threadComment.commentId)),
    conversationFloorCeiling: floorCeilingBelow(unhandledConversationIds),
  };
}
