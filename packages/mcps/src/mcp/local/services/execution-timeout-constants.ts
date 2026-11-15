/** Run timeouts for local executions whose caller sets none. */

/** Longest a test-script generation runs before it is stopped. */
export const DEFAULT_GENERATION_TIMEOUT_MS = 300_000;

/** Longest a replay runs before it is stopped. */
export const DEFAULT_REPLAY_TIMEOUT_MS = 180_000;

/** Longest a website scan runs before it is stopped, keeping the candidates it found. */
export const DEFAULT_WEBSITE_SCAN_TIMEOUT_MS = 1_800_000;
