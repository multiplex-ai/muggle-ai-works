/**
 * Substring present in every `muggle build-pr-section` rendering (see
 * src/cli/build-pr-section.ts). Version-agnostic so recognisers keep working
 * across `:v1` → `:v2` bumps.
 */
export const REPORT_SENTINEL = "muggle-pr-section";

/**
 * Marks the one comment on a PR reserved for the Muggle AI visual walkthrough.
 * Distinct from {@link REPORT_SENTINEL} so a reserved-but-empty slot never reads
 * as a posted walkthrough.
 */
export const WALKTHROUGH_SLOT_MARKER = "<!-- muggle-pr-walkthrough:v1 -->";

/** Marks the designated comment as deliberately settled without a run. */
export const WALKTHROUGH_SKIPPED_MARKER = "<!-- muggle-pr-walkthrough-status:skipped -->";

/**
 * Headline of the retired settle a released E2E gate once posted. It carried
 * {@link WALKTHROUGH_SKIPPED_MARKER} with no reason, so a comment showing it
 * classifies as pending: the PR is still owed a run or a reason.
 */
export const RETIRED_UNREASONED_SKIP_HEADLINE = "**No E2E run, and no verified reason given.**";

/** Heading every rendering of the designated comment opens with. */
export const WALKTHROUGH_COMMENT_HEADING = "### Muggle AI — PR visual walkthrough";

/** The whole HTML comment carrying {@link REPORT_SENTINEL}, so a carried-forward walkthrough stops reading as the current report. */
export const REPORT_SENTINEL_TAG = new RegExp(`<!--\\s*${REPORT_SENTINEL}[^>]*-->\\s*`, "g");

/** Opening of the collapsed block that keeps the last full run's walkthrough under a skipped notice; its closing tag ends the comment. */
export const LAST_FULL_RUN_OPENING = "<details><summary>Last full E2E run on this PR</summary>";

/** Opens the banner saying an E2E run is in progress — above the walkthrough it will replace, or in place of the placeholder on a first run. */
export const RERUN_NOTICE_OPENING = "<!-- muggle-pr-walkthrough-rerun -->";

/** Closes the banner {@link RERUN_NOTICE_OPENING} opens. */
export const RERUN_NOTICE_CLOSING = "<!-- /muggle-pr-walkthrough-rerun -->";

/** The whole rerun banner with the blank lines after it, so stripping it gives back the walkthrough it sat on. */
export const RERUN_NOTICE_BLOCK = new RegExp(`${RERUN_NOTICE_OPENING}[\\s\\S]*?${RERUN_NOTICE_CLOSING}\\s*`, "g");

/** Characters of a commit SHA shown to reviewers, matching git's default abbreviation. */
export const SHORT_SHA_LENGTH = 7;

/** Ceiling on each `gh` call made while reserving or settling the comment; a hung call must never hold a tool call or a CI job. */
export const GH_COMMENT_TIMEOUT_MS = 10_000;

/**
 * PR authors whose PRs never pass through a Muggle session: dependency bots
 * open them on a schedule, and nothing would ever settle their slot, so the
 * walkthrough check settles it itself.
 */
export const DEPENDENCY_BOT_LOGINS: readonly string[] = ["dependabot[bot]", "renovate[bot]"];
