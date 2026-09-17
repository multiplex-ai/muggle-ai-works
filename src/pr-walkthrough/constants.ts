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

/** Heading every rendering of the designated comment opens with. */
export const WALKTHROUGH_COMMENT_HEADING = "### Muggle AI — PR visual walkthrough";

/** Ceiling on each `gh` call made while reserving or settling the comment; a hung call must never hold a tool call or a CI job. */
export const GH_COMMENT_TIMEOUT_MS = 10_000;
