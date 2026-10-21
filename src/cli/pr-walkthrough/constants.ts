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

/** Conclusion each outcome publishes. An unreadable PR is neutral, never a failure. */
export const OUTCOME_CONCLUSIONS: Record<WalkthroughCheckOutcome, CheckConclusion> = {
  [WalkthroughCheckOutcome.Settled]: CheckConclusion.Success,
  [WalkthroughCheckOutcome.E2eNotPassing]: CheckConclusion.Failure,
  [WalkthroughCheckOutcome.Unsettled]: CheckConclusion.Failure,
  [WalkthroughCheckOutcome.Unreadable]: CheckConclusion.Neutral,
};

/** Summary for every outcome whose text does not depend on the run. */
export const FIXED_SUMMARIES: Record<Exclude<WalkthroughCheckOutcome, WalkthroughCheckOutcome.E2eNotPassing>, string> = {
  [WalkthroughCheckOutcome.Settled]:
    "This PR's Muggle AI walkthrough comment is settled — every E2E acceptance case passed, or it states why E2E does not apply.",
  [WalkthroughCheckOutcome.Unsettled]:
    "This PR's Muggle AI walkthrough comment is still empty. Run the E2E acceptance suite and post the walkthrough into it (/muggle:muggle-test), or record why E2E does not apply to this change.",
  [WalkthroughCheckOutcome.Unreadable]:
    "The PR's comments could not be read, so the walkthrough duty could not be judged.",
};
