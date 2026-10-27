import { latestE2eResult } from "../../e2e-result/marker.js";
import { isRerunInProgress, walkthroughVerdict } from "../../pr-walkthrough/comment.js";
import { DEPENDENCY_BOT_LOGINS } from "../../pr-walkthrough/constants.js";
import { createCheckRun, defaultGhRunner, listPrComments, readPrAuthorLogin } from "../../pr-walkthrough/gh.js";
import { reserveComment, settleDependencyBotComment } from "../../pr-walkthrough/reserve.js";
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
  CheckRunStatus,
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
 *
 * A dependency bot's PR is settled here rather than left owing: no session ever
 * runs on it, so its slot would stay empty and the check red forever.
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
  if (verdict !== WalkthroughVerdict.Satisfied) {
    const author = readPrAuthorLogin(pr, run);
    if (author && DEPENDENCY_BOT_LOGINS.includes(author)) {
      settleDependencyBotComment(pr, comments, author, run);
      return {
        outcome: WalkthroughCheckOutcome.Settled,
        summary: FIXED_SUMMARIES[WalkthroughCheckOutcome.Settled],
      };
    }
  }
  // A slot reserved just now can already be settled — a PR no browser run can
  // observe opens on its skip — so this run judges what it posted.
  const reservedBody = verdict === WalkthroughVerdict.Missing ? reserveComment(pr, comments, run) : null;
  const verdictNow = reservedBody === null ? verdict : walkthroughVerdict([...bodies, reservedBody]);

  // Ahead of the record: the run under the banner is the one being replaced, so
  // neither its pass nor its failures are this PR's verdict.
  if (isRerunInProgress(bodies)) {
    return {
      outcome: WalkthroughCheckOutcome.RerunInProgress,
      summary: FIXED_SUMMARIES[WalkthroughCheckOutcome.RerunInProgress],
    };
  }

  const record = latestE2eResult(bodies);
  if (record && record.unpassed.length > 0) {
    return { outcome: WalkthroughCheckOutcome.E2eNotPassing, summary: renderNotPassingSummary(record) };
  }
  const outcome =
    verdictNow === WalkthroughVerdict.Satisfied ? WalkthroughCheckOutcome.Settled : WalkthroughCheckOutcome.Unsettled;
  return { outcome: outcome, summary: FIXED_SUMMARIES[outcome] };
}

/**
 * Judge whether a PR's designated walkthrough comment is settled and passing.
 *
 * Fails when the comment is still empty, and when the newest walkthrough
 * reports any failed or inconclusive case — naming each one in the summary.
 * Passes on a skip, including the agent's own `NOT_APPLICABLE` with its reason,
 * and settles a dependency bot's PR as not applicable. Stays in progress while
 * the comment carries a rerun banner, until the new run's walkthrough lands.
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
  const status = conclusion === null ? CheckRunStatus.InProgress : CheckRunStatus.Completed;

  if (options.publishCheckRun) {
    createCheckRun(
      options.repo,
      {
        name: CHECK_RUN_NAME,
        headSha: options.headSha,
        status: status,
        conclusion: conclusion,
        title: CHECK_RUN_TITLE,
        summary: summary,
      },
      run,
    );
  }

  // A run still in progress has not passed, so locally it fails like an empty slot.
  const isNotPassing = conclusion === CheckConclusion.Failure || status === CheckRunStatus.InProgress;
  const failsLocally = isNotPassing && !options.publishCheckRun;
  return {
    outcome: outcome,
    status: status,
    conclusion: conclusion,
    exitCode: failsLocally ? 1 : 0,
    summary: summary,
  };
}
