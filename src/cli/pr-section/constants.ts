/**
 * Display constants for the PR evidence block. Kept out of render.ts so the
 * emitters hold only layout logic.
 */

/**
 * Dashboard projects base used when the caller supplies none.
 *
 * Production, because a report rendered without a resolved runtime target is
 * overwhelmingly a production run. A caller on another ring passes its own base
 * so the link lands on the environment the run actually happened in.
 */
export const DASHBOARD_URL_BASE =
  "https://www.muggle-ai.com/muggleTestV0/dashboard/projects";

/** Width of the per-test ending screenshot inside each <details> block. */
export const DETAIL_IMAGE_WIDTH = 720;

/** Width of a step's screenshot, shown when that step is expanded. */
export const STEP_IMAGE_WIDTH = 640;

/**
 * Step counts above this render an elided list instead of every step. Each step
 * carries its own screenshot, so a long run would otherwise bury the ending
 * screen and push the body over the overflow budget.
 */
export const STEP_LIST_ELISION_THRESHOLD = 20;

/** Steps shown from the start of an elided list. */
export const STEP_LIST_HEAD_COUNT = 12;

/** Steps shown from the end of an elided list, where a failure lands. */
export const STEP_LIST_TAIL_COUNT = 8;

/**
 * The internal element reference the agent writes into a step's explanation,
 * in either of the forms recorded runs use ("… link with element id [3] to …",
 * "… field with element id #0."). Meaningless to a reviewer — and GitHub
 * autolinks a bare `#0` as an issue — so it is dropped from the rendered step.
 */
export const STEP_ELEMENT_ID_SUFFIX = /\s*with element id (?:\[\d+\]|#\d+)/g;
