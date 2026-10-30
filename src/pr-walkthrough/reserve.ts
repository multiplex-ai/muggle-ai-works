import { tmpdir } from "os";
import { join } from "path";
import { isNonAppPath, parseNoAppLogicChangeDetail } from "../e2e-skip/noAppLogicChange.js";
import type { E2eSkipCode } from "../e2e-skip/types.js";
import { withFileLock } from "../guardrails/store/fileLock.js";
import {
  classifyComment,
  hasRerunNotice,
  lastFullRunOf,
  renderDependencyBotComment,
  renderNoAppLogicChangeComment,
  renderReservedComment,
  renderRunningComment,
  renderSkippedComment,
  walkthroughVerdict,
  withoutRerunNotice,
  withRerunNotice,
} from "./comment.js";
import { DESIGNATED_COMMENT_LOCK_PREFIX, DESIGNATED_COMMENT_LOCK_WAIT_MS } from "./constants.js";
import { readProgressCases, withFinishedCase, withProgressSection } from "./progress.js";
import {
  defaultGhRunner,
  listPrComments,
  parsePrUrl,
  patchPrComment,
  postPrComment,
  readPrDiffPaths,
  readPrHeadSha,
} from "./gh.js";
import {
  E2eProgressStatus,
  WalkthroughCommentStatus,
  WalkthroughVerdict,
  type E2eProgressCase,
  type GhRunner,
  type PrComment,
  type PrCoordinates,
} from "./types.js";

function commentWithStatus(
  comments: PrComment[],
  status: WalkthroughCommentStatus,
): PrComment | undefined {
  return comments.find((comment) => classifyComment(comment.body) === status);
}

// The first marked comment, which is also the one the walkthrough builder
// fills, so every write here lands where the next walkthrough will.
function designatedComment(comments: PrComment[]): PrComment | undefined {
  return comments.find((comment) => classifyComment(comment.body) !== WalkthroughCommentStatus.NotDesignated);
}

// A PR no browser run can observe would wait forever for a run to fill the
// placeholder, so it opens on its settled skip instead — judged by the same path
// rule that verifies a declared NO_APP_LOGIC_CHANGE. Only a diff read in full
// vouches for that; anything unread keeps the placeholder.
function openingCommentBody(pr: PrCoordinates, run: GhRunner): string {
  const diff = readPrDiffPaths(pr, run);
  if (!diff || diff.changedPaths.length === 0 || !diff.changedPaths.every(isNonAppPath)) {
    return renderReservedComment();
  }
  return renderNoAppLogicChangeComment(
    { preCycleSha: diff.mergeBaseSha, baseTipSha: null, reason: "" },
    diff.headSha,
    null,
  );
}

/**
 * Post the comment that holds the walkthrough slot, unless the PR already has
 * one or already carries a walkthrough.
 *
 * A PR whose every changed path is docs, tests, lint/format config, or CI config
 * gets its settled `NO_APP_LOGIC_CHANGE` skip instead of the placeholder.
 *
 * @returns The body posted, or `null` when nothing was.
 */
export function reserveComment(
  pr: PrCoordinates,
  comments: PrComment[],
  run: GhRunner,
): string | null {
  if (designatedComment(comments)) return null;
  const body = openingCommentBody(pr, run);
  return postPrComment(pr, body, run) ? body : null;
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
  return reserveComment(pr, comments, run) !== null;
}

/**
 * Whether the PR's comments now discharge the walkthrough duty, with a
 * walkthrough or a settled skip. False when the comments cannot be read, so a
 * caller proving a write landed never mistakes an outage for success.
 */
export function isWalkthroughSettledOnPr(prUrl: string, run: GhRunner = defaultGhRunner): boolean {
  const pr = parsePrUrl(prUrl);
  if (!pr) return false;
  const comments = listPrComments(pr, run);
  if (comments === null) return false;
  return walkthroughVerdict(comments.map((comment) => comment.body)) === WalkthroughVerdict.Satisfied;
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
  const designated = designatedComment(comments);
  const lastFullRun = designated ? lastFullRunOf(designated.body) : null;
  const body = renderNoAppLogicChangeComment(declared, readPrHeadSha(pr, run), lastFullRun);
  return designated ? patchPrComment(pr, designated.id, body, run) : postPrComment(pr, body, run);
}

/**
 * Mark the PR's walkthrough as having an E2E run in progress.
 *
 * A pending placeholder is replaced with the running notice; a comment that
 * already shows a run or a skip gets the banner on top, kept whole underneath.
 * Idempotent across a run's many executions — the first one marks the comment,
 * the rest find the banner — and the walkthrough the run posts replaces the
 * whole body, banner included.
 *
 * @param startedAt - When the run started.
 * @returns Whether the notice reached the PR.
 */
export function noteE2eRunStarted(
  prUrl: string,
  run: GhRunner = defaultGhRunner,
  startedAt: Date = new Date(),
): boolean {
  return rewriteDesignatedComment(prUrl, run, (body) =>
    hasRerunNotice(body) ? null : withRunStartedNotice(body, startedAt),
  );
}

/**
 * Post the test cases a run is about to execute, each queued, under a fresh
 * in-progress banner — so a reviewer sees what the run covers before its first
 * result. Replaces any earlier run's banner and progress: a plan starts a run.
 *
 * @param planned - The cases in the order they will run; their status is ignored.
 * @param startedAt - When the run started.
 * @returns Whether the plan reached the PR.
 */
export function noteE2ePlan(
  prUrl: string,
  planned: Pick<E2eProgressCase, "testCaseId" | "title">[],
  run: GhRunner = defaultGhRunner,
  startedAt: Date = new Date(),
): boolean {
  const queued = planned.map((plannedCase) => ({
    testCaseId: plannedCase.testCaseId,
    title: plannedCase.title,
    status: E2eProgressStatus.Queued,
  }));
  return rewriteDesignatedComment(prUrl, run, (body) =>
    withProgressSection(withRunStartedNotice(body, startedAt), queued),
  );
}

/**
 * Record one finished test case in the progress table of the run in flight.
 *
 * Does nothing once no banner is left — the run's walkthrough has replaced it,
 * and a late update must never write the in-progress body back over the report.
 *
 * @returns Whether the update reached the PR.
 */
export function noteE2eCaseFinished(
  prUrl: string,
  finished: E2eProgressCase,
  run: GhRunner = defaultGhRunner,
): boolean {
  return rewriteDesignatedComment(prUrl, run, (body) =>
    withProgressSection(body, withFinishedCase(readProgressCases(body), finished)),
  );
}

// A pending placeholder becomes the running notice; a comment that shows a run
// or a skip gets the banner on top. An earlier banner is dropped first, so a
// run abandoned mid-way never leaves its start time on the next one.
function withRunStartedNotice(body: string, startedAt: Date): string {
  const unmarked = withoutRerunNotice(body);
  return classifyComment(unmarked) === WalkthroughCommentStatus.Pending
    ? renderRunningComment(startedAt)
    : withRerunNotice(unmarked, startedAt);
}

// A run's plan, its start banner, and each finished case are written by
// separate detached jobs that can overlap; the lock keeps each read-modify-write
// from landing on a body another one already replaced.
function rewriteDesignatedComment(
  prUrl: string,
  run: GhRunner,
  rewrite: (body: string) => string | null,
): boolean {
  const pr = parsePrUrl(prUrl);
  if (!pr) return false;
  const lockPath = join(tmpdir(), `${DESIGNATED_COMMENT_LOCK_PREFIX}${pr.repo.replace("/", "-")}-${pr.prNumber}.lock`);
  const isWritten = withFileLock(lockPath, DESIGNATED_COMMENT_LOCK_WAIT_MS, () => {
    const comments = listPrComments(pr, run);
    if (comments === null) return false;
    const designated = designatedComment(comments);
    if (!designated) return false;
    const body = rewrite(designated.body);
    return body !== null && patchPrComment(pr, designated.id, body, run);
  });
  return isWritten ?? false;
}
