/** Where the walkthrough check lives in a consuming repository. */
export const USER_WORKFLOW_PATH = ".github/workflows/muggle-walkthrough.yml";

/**
 * How a consuming repo invokes the check.
 *
 * Unpinned on purpose: the guard fails open, so the blast radius of a bad
 * release is a neutral check rather than a blocked merge — and a pinned version
 * in every consumer's repo is a fleet nobody upgrades.
 */
export const USER_WORKFLOW_COMMAND =
  "npx -y -p @muggleai/works muggle pr-walkthrough-check --check-run";

/**
 * SHA-256 of the current rendering, with line endings normalized to LF.
 *
 * A test pins it to the template, so changing the template fails until this
 * hash moves into `PRIOR_USER_WORKFLOW_SHA256S` and the new one replaces it.
 */
export const USER_WORKFLOW_SHA256 = "761a0ef73d988d6538232f7ab2482377012e869d69eef4e836ae6001b61de970";

/**
 * SHA-256 of every earlier rendering a release installed, line endings normalized.
 *
 * A copy matching one of these was never edited, so it is safe to replace with
 * the current rendering; a copy matching none is the consumer's own.
 */
export const PRIOR_USER_WORKFLOW_SHA256S: ReadonlySet<string> = new Set([
  "d7fb2892a4a7684a3f08de060a86bce60a02d10a7a63587b1a6836163828e881",
  "908e0c71af8a2e8ac3d9c3afe3ecb8c8b7537c7e7e5d886a0dacdfa806351d9c",
]);
