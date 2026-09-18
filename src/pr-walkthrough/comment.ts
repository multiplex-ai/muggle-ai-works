import {
  REPORT_SENTINEL,
  WALKTHROUGH_COMMENT_HEADING,
  WALKTHROUGH_SKIPPED_MARKER,
  WALKTHROUGH_SLOT_MARKER,
} from "./constants.js";
import { WalkthroughCommentStatus, WalkthroughVerdict } from "./types.js";

/** Body of the placeholder posted when a PR opens, holding the slot until a run settles it. */
export function renderReservedComment(): string {
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `_Awaiting the E2E acceptance run. Muggle edits this comment in place when the run finishes — ` +
    `or records why E2E does not apply to this change._`
  );
}

/**
 * Body that settles the slot without a run.
 *
 * A blank reason renders the reserved body instead: an unexplained skip is the
 * thing this guard exists to catch, so it must not be able to close the slot.
 */
export function renderSkippedComment(reason: string): string {
  const stated = reason.trim();
  if (!stated) return renderReservedComment();
  return (
    `${WALKTHROUGH_SLOT_MARKER}\n` +
    `${WALKTHROUGH_SKIPPED_MARKER}\n` +
    `${WALKTHROUGH_COMMENT_HEADING}\n\n` +
    `**E2E skipped** — ${stated}`
  );
}

/**
 * What one comment body is.
 *
 * A rendered walkthrough counts as reported whether or not it carries the slot
 * marker, so walkthroughs posted before this guard existed still discharge the
 * duty rather than reading as a PR that never ran one.
 */
export function classifyComment(body: string): WalkthroughCommentStatus {
  if (body.includes(REPORT_SENTINEL)) return WalkthroughCommentStatus.Reported;
  if (!body.includes(WALKTHROUGH_SLOT_MARKER)) return WalkthroughCommentStatus.NotDesignated;
  if (body.includes(WALKTHROUGH_SKIPPED_MARKER)) return WalkthroughCommentStatus.Skipped;
  return WalkthroughCommentStatus.Pending;
}

/** Whether a PR's comments discharge the walkthrough duty, reserve it, or leave it unclaimed. */
export function walkthroughVerdict(bodies: string[]): WalkthroughVerdict {
  const statuses = bodies.map(classifyComment);
  if (
    statuses.includes(WalkthroughCommentStatus.Reported) ||
    statuses.includes(WalkthroughCommentStatus.Skipped)
  ) {
    return WalkthroughVerdict.Satisfied;
  }
  if (statuses.includes(WalkthroughCommentStatus.Pending)) return WalkthroughVerdict.Pending;
  return WalkthroughVerdict.Missing;
}
