import { walkthroughVerdict } from "../../pr-walkthrough/comment.js";
import { createCheckRun, defaultGhRunner, listPrComments } from "../../pr-walkthrough/gh.js";
import { reserveComment } from "../../pr-walkthrough/reserve.js";
import { WalkthroughVerdict, type GhRunner, type PrCoordinates } from "../../pr-walkthrough/types.js";
import {
  CheckConclusion,
  type PrWalkthroughCheckOptions,
  type PrWalkthroughCheckResult,
} from "./types.js";

/** Check-run name reviewers see, and the context a branch protection rule requires. */
export const CHECK_RUN_NAME = "muggle-walkthrough";

const SUMMARIES: Record<CheckConclusion, string> = {
  [CheckConclusion.Success]:
    "This PR's Muggle AI walkthrough comment is settled — it carries the E2E acceptance walkthrough, or states why E2E does not apply.",
  [CheckConclusion.Failure]:
    "This PR's Muggle AI walkthrough comment is still empty. Run the E2E acceptance suite and post the walkthrough into it (/muggle:muggle-test), or record why E2E does not apply to this change.",
  [CheckConclusion.Neutral]:
    "The PR's comments could not be read, so the walkthrough duty could not be judged.",
};

function conclusionFor(verdict: WalkthroughVerdict): CheckConclusion {
  return verdict === WalkthroughVerdict.Satisfied ? CheckConclusion.Success : CheckConclusion.Failure;
}

/**
 * Judge whether a PR's designated walkthrough comment is settled.
 *
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
  const comments = listPrComments(pr, run);

  let conclusion = CheckConclusion.Neutral;
  if (comments !== null) {
    const verdict = walkthroughVerdict(comments.map((comment) => comment.body));
    if (verdict === WalkthroughVerdict.Missing) reserveComment(pr, comments, run);
    conclusion = conclusionFor(verdict);
  }

  if (options.publishCheckRun) {
    createCheckRun(
      options.repo,
      {
        name: CHECK_RUN_NAME,
        headSha: options.headSha,
        conclusion: conclusion,
        title: "Muggle AI PR visual walkthrough",
        summary: SUMMARIES[conclusion],
      },
      run,
    );
  }

  const failsLocally = conclusion === CheckConclusion.Failure && !options.publishCheckRun;
  return {
    conclusion: conclusion,
    exitCode: failsLocally ? 1 : 0,
    summary: SUMMARIES[conclusion],
  };
}
