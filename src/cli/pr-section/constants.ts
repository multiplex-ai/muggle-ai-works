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

/**
 * Step counts above this render an elided list instead of every step. Sized so
 * a short run stays whole and a long one cannot crowd out the screenshot below
 * it or push the body over the overflow budget.
 */
export const STEP_LIST_ELISION_THRESHOLD = 10;

/** Steps shown from the start of an elided list. */
export const STEP_LIST_HEAD_COUNT = 6;

/** Steps shown from the end of an elided list, where a failure lands. */
export const STEP_LIST_TAIL_COUNT = 3;
