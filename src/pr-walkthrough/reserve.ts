import { parseNoAppLogicChangeDetail } from "../e2e-skip/noAppLogicChange.js";
import type { E2eSkipCode } from "../e2e-skip/types.js";
import {
  classifyComment,
  lastFullRunOf,
  renderDependencyBotComment,
  renderNoAppLogicChangeComment,
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
  readPrHeadSha,
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
 * Settle the slot on a PR a dependency bot opened: fill the reserved
 * placeholder, or post the notice when the PR has none.
 *
 * @returns Whether the notice reached the PR.
 */
export function settleDependencyBotComment(
  pr: PrCoordinates,
  comments: PrComment[],
  login: string,
  run: GhRunner,
): boolean {
  const body = renderDependencyBotComment(login);
  const reserved = commentWithStatus(comments, WalkthroughCommentStatus.Pending);
  return reserved ? patchPrComment(pr, reserved.id, body, run) : postPrComment(pr, body, run);
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
 * Record on the PR that its newest commits changed no app logic.
 *
 * Unlike every other skip, this one supersedes a posted walkthrough: the run
 * that walkthrough shows predates the head now under review, so leaving it as
 * the PR's current verdict would vouch for commits it never saw. The run is not
 * lost — it moves under the notice as the last full run, result record and
 * all, so a run that failed keeps the walkthrough check red: commits that
 * changed no app logic cannot have repaired it.
 *
 * @param detail - The verified declaration's detail: the pre-cycle SHA, then the reason.
 * @returns Whether the notice reached the PR.
 */
export function settleWalkthroughCommentForNoAppLogicChange(
  prUrl: string,
  detail: string,
  run: GhRunner = defaultGhRunner,
): boolean {
  const pr = parsePrUrl(prUrl);
  const declared = parseNoAppLogicChangeDetail(detail);
  if (!pr || !declared) return false;
  const comments = listPrComments(pr, run);
  if (comments === null) return false;
  const designated = comments.find(
    (comment) => classifyComment(comment.body) !== WalkthroughCommentStatus.NotDesignated,
  );
  const lastFullRun = designated ? lastFullRunOf(designated.body) : null;
  const body = renderNoAppLogicChangeComment(declared, readPrHeadSha(pr, run), lastFullRun);
  return designated ? patchPrComment(pr, designated.id, body, run) : postPrComment(pr, body, run);
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
