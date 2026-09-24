import type { E2eSkipCode } from "../e2e-skip/types.js";
import {
  classifyComment,
  renderReservedComment,
  renderSkippedComment,
  renderUnreasonedSkipComment,
} from "./comment.js";
import {
  defaultGhRunner,
  listPrComments,
  parsePrUrl,
  patchPrComment,
  postPrComment,
} from "./gh.js";
import { WalkthroughCommentStatus, type GhRunner, type PrComment, type PrCoordinates } from "./types.js";

function commentWithStatus(
  comments: PrComment[],
  status: WalkthroughCommentStatus,
): PrComment | undefined {
  return comments.find((comment) => classifyComment(comment.body) === status);
}

/**
 * Post the placeholder that holds the walkthrough slot, unless the PR already
 * has one or already carries a walkthrough.
 *
 * @returns Whether a comment was posted.
 */
export function reserveComment(
  pr: PrCoordinates,
  comments: PrComment[],
  run: GhRunner,
): boolean {
  const claimed = comments.some(
    (comment) => classifyComment(comment.body) !== WalkthroughCommentStatus.NotDesignated,
  );
  if (claimed) return false;
  return postPrComment(pr, renderReservedComment(), run);
}

/**
 * Reserve the designated walkthrough comment on a freshly opened PR.
 *
 * Idempotent, and silent about every failure: an unreachable provider must
 * never fail the tool call that opened the PR. GitLab MRs are left alone — the
 * slot is a GitHub comment.
 *
 * @returns Whether a comment was posted.
 */
export function reserveWalkthroughComment(prUrl: string, run: GhRunner = defaultGhRunner): boolean {
  const pr = parsePrUrl(prUrl);
  if (!pr) return false;
  const comments = listPrComments(pr, run);
  if (comments === null) return false;
  return reserveComment(pr, comments, run);
}

function settleWith(prUrl: string, body: string, run: GhRunner): boolean {
  const pr = parsePrUrl(prUrl);
  if (!pr) return false;
  const comments = listPrComments(pr, run);
  if (comments === null) return false;
  if (commentWithStatus(comments, WalkthroughCommentStatus.Reported)) return false;
  if (commentWithStatus(comments, WalkthroughCommentStatus.Skipped)) return false;
  const reserved = commentWithStatus(comments, WalkthroughCommentStatus.Pending);
  return reserved ? patchPrComment(pr, reserved.id, body, run) : postPrComment(pr, body, run);
}

/**
 * Record in the open why this PR gets no walkthrough.
 *
 * Takes the verified code, never prose. A posted walkthrough always wins: a
 * skip declared after a run must not erase the evidence the run produced.
 *
 * @returns Whether the reason reached the PR.
 */
export function settleWalkthroughCommentAsSkipped(
  prUrl: string,
  code: E2eSkipCode,
  detail: string,
  run: GhRunner = defaultGhRunner,
): boolean {
  return settleWith(prUrl, renderSkippedComment(code, detail), run);
}

/**
 * Record that the session ended owing an acceptance run and never cited a
 * verifiable code.
 *
 * @returns Whether the notice reached the PR.
 */
export function settleWalkthroughCommentAsUnreasoned(
  prUrl: string,
  run: GhRunner = defaultGhRunner,
): boolean {
  return settleWith(prUrl, renderUnreasonedSkipComment(), run);
}
