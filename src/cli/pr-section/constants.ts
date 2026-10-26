/**
 * Display constants for the PR evidence block. Kept out of render.ts so the
 * emitters hold only layout logic.
 */

/** Width of the per-test ending screenshot, shown above the steps collapsible. */
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

/**
 * Leads each step's collapsible row. GitHub's disclosure triangle is small and only the cursor change on hover
 * says a row opens, so the camera tells a reader at a glance that each row holds a screenshot.
 */
export const STEP_SCREENSHOT_MARKER = "📷";

/** Separates one test's details from the next; GitHub renders it as a full-width rule. */
export const TEST_DETAILS_DIVIDER = "---";

/** Joins a short ID to the text it labels, as in `TC-42 · Checkout`. */
export const SHORT_ID_LABEL_SEPARATOR = " · ";

/** Prefix of the in-page anchor on each test's details; the summary's "see details" links point at it. */
export const TEST_DETAILS_ANCHOR_PREFIX = "muggle-test-";

/**
 * Width, in pixels, the image proxy resizes a step screenshot to. GitHub fetches every image on the page, even
 * inside a closed collapsible, and strips `loading="lazy"`, so a smaller download is the only lever; twice the
 * displayed width keeps the thumbnail sharp on a high-density screen.
 */
export const STEP_THUMBNAIL_WIDTH_PX = 840;

/** JPEG quality the image proxy encodes step thumbnails at. */
export const STEP_THUMBNAIL_QUALITY = 70;

/** Displayed width of each screenshot when a step shows its before and after side by side. */
export const STEP_PAIR_IMAGE_WIDTH = 420;

/** GitHub rejects a comment longer than 65,536 characters; the overflow comment stays under this with headroom. */
export const MAX_COMMENT_BYTES = 64_000;
