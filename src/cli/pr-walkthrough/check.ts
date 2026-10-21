import { latestE2eResult } from "../../e2e-result/marker.js";
import { walkthroughVerdict } from "../../pr-walkthrough/comment.js";
import { createCheckRun, defaultGhRunner, listPrComments } from "../../pr-walkthrough/gh.js";
import { reserveComment } from "../../pr-walkthrough/reserve.js";
import {
  WalkthroughVerdict,
  type GhRunner,
  type PrComment,
  type PrCoordinates,
} from "../../pr-walkthrough/types.js";
import { CHECK_RUN_NAME, CHECK_RUN_TITLE, FIXED_SUMMARIES, OUTCOME_CONCLUSIONS } from "./constants.js";
import { renderNotPassingSummary } from "./summary.js";
import {
  CheckConclusion,
  WalkthroughCheckOutcome,
  type PrWalkthroughCheckOptions,
  type PrWalkthroughCheckResult,
} from "./types.js";

/**
 * What the PR's comments say, and the summary that says it.
 *
 * A walkthrough without a result record predates the record and keeps counting
 * as settled; judging it failed would redden every PR whose walkthrough an
 * older CLI rendered.
 */
function judgeComments(
  pr: PrCoordinates,
  comments: PrComment[] | null,
  run: GhRunner,
): Pick<PrWalkthroughCheckResult, "outcome" | "summary"> {
  if (comments === null) {
    return { outcome: WalkthroughCheckOutcome.Unreadable, summary: FIXED_SUMMARIES[WalkthroughCheckOutcome.Unreadable] };
  }
  const bodies = comments.map((comment) => comment.body);
  const verdict = walkthroughVerdict(bodies);
  if (verdict === WalkthroughVerdict.Missing) reserveComment(pr, comments, run);

  const record = latestE2eResult(bodies);
  if (record && record.unpassed.length > 0) {
    return { outcome: WalkthroughCheckOutcome.E2eNotPassing, summary: renderNotPassingSummary(record) };
  }
  const outcome =
    verdict === WalkthroughVerdict.Satisfied ? WalkthroughCheckOutcome.Settled : WalkthroughCheckOutcome.Unsettled;
  return { outcome: outcome, summary: FIXED_SUMMARIES[outcome] };
}

/**
 * Judge whether a PR's designated walkthrough comment is settled and passing.
 *
 * Fails when the comment is still empty, and when the newest walkthrough
 * reports any failed or inconclusive case — naming each one in the summary.
 * Reserves the comment when the PR has none, so a PR opened outside a Muggle
 * session still ends up with the slot reviewers expect. An unreadable PR is
 * neutral, never a failure: a check that fails on its own blindness is a check
 * that gets made non-required.
 *
 * With `publishCheckRun`, the verdict rides a check run against the head SHA
 * and the process still exits 0 — the check run is the signal. Without it the
 * exit code is the signal, for a local `muggle pr-walkthrough-check`.
 */
export async function runPrWalkthroughCheck(
  options: PrWalkthroughCheckOptions,
  run: GhRunner = defaultGhRunner,
): Promise<PrWalkthroughCheckResult> {
  const pr: PrCoordinates = { repo: options.repo, prNumber: options.prNumber };
  const { outcome, summary } = judgeComments(pr, listPrComments(pr, run), run);
  const conclusion = OUTCOME_CONCLUSIONS[outcome];

  if (options.publishCheckRun) {
    createCheckRun(
      options.repo,
      {
        name: CHECK_RUN_NAME,
        headSha: options.headSha,
        conclusion: conclusion,
        title: CHECK_RUN_TITLE,
        summary: summary,
      },
      run,
    );
  }

  const failsLocally = conclusion === CheckConclusion.Failure && !options.publishCheckRun;
  return {
    outcome: outcome,
    conclusion: conclusion,
    exitCode: failsLocally ? 1 : 0,
    summary: summary,
  };
}
