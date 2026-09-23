/** Directory under the Muggle home that holds one subdirectory per run. */
export const RUN_SESSIONS_DIR_NAME = "sessions";

/** Action script a run writes as it executes; the source of the step list. */
export const ACTION_SCRIPT_FILE_NAME = "action-script.json";

/** Directory holding the frames a run captured, relative to the session directory. */
export const SCREENSHOT_DIR_RELATIVE_PATH = "electron-runtime/screenshot";

/** Extension every captured frame carries. */
export const SCREENSHOT_FILE_EXTENSION = ".jpg";

/**
 * Closing line of every terminal render.
 *
 * A run's frames are the evidence; the terminal cannot show them. Printing the way to see them
 * on every render — not only on failures, and not behind a flag the reader has to already know
 * about — is what stops the next person hand-writing a script to open a screenshot, which is the
 * gap this viewer was built to close.
 */
export const HTML_VIEW_OFFER_LINE = "See the frames: re-run with --html (add --open to open it).";
