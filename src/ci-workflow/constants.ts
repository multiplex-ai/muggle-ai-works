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
