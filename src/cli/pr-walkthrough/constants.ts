import { CheckConclusion, WalkthroughCheckOutcome } from "./types.js";

/** Check-run name reviewers see, and the context a branch protection rule requires. */
export const CHECK_RUN_NAME = "muggle-walkthrough";

/** Title of the published check run. */
export const CHECK_RUN_TITLE = "Muggle AI PR visual walkthrough";

/**
 * Most non-passing cases a check summary lists by name. GitHub caps a check
 * run's summary at 65,535 characters; the walkthrough comment holds the rest.
 */
export const CHECK_SUMMARY_MAX_CASES = 50;

/**
 * Conclusion each outcome publishes. An unreadable PR is neutral, never a failure.
 * So is a walkthrough whose only failures also fail on the base: they are real,
 * and listed, but not this PR's to fix — neutral passes a required check.
 * A rerun has none yet: its check run stays in progress, which reads as pending
 * rather than as a pass on the run being replaced or a failure that would send
 * a watcher to fix CI while the rerun is still going.
 */
export const OUTCOME_CONCLUSIONS: Record<WalkthroughCheckOutcome, CheckConclusion | null> = {
  [WalkthroughCheckOutcome.Settled]: CheckConclusion.Success,
  [WalkthroughCheckOutcome.E2eNotPassing]: CheckConclusion.Failure,
  [WalkthroughCheckOutcome.E2eFailsOnBase]: CheckConclusion.Neutral,
  [WalkthroughCheckOutcome.RerunInProgress]: null,
  [WalkthroughCheckOutcome.Unsettled]: CheckConclusion.Failure,
  [WalkthroughCheckOutcome.Unreadable]: CheckConclusion.Neutral,
};

/** Summary for every outcome whose text does not depend on the run. */
export const FIXED_SUMMARIES: Record<
  Exclude<WalkthroughCheckOutcome, WalkthroughCheckOutcome.E2eNotPassing | WalkthroughCheckOutcome.E2eFailsOnBase>,
  string
> = {
  [WalkthroughCheckOutcome.Settled]:
    "This PR's Muggle AI walkthrough comment is settled — every E2E acceptance case passed, or it states why E2E does not apply.",
  [WalkthroughCheckOutcome.RerunInProgress]:
    "A new E2E acceptance run is in progress on this PR. The walkthrough comment still shows the previous run; this check settles when the new run's walkthrough replaces it.",
  [WalkthroughCheckOutcome.Unsettled]:
    "This PR's Muggle AI walkthrough comment is still empty. Run the E2E acceptance suite and post the walkthrough into it (/muggle:muggle-test), or record why E2E does not apply to this change.",
  [WalkthroughCheckOutcome.Unreadable]:
    "The PR's comments could not be read, so the walkthrough duty could not be judged.",
};
