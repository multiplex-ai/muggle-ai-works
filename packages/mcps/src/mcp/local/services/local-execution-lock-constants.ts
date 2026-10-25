/**
 * Tunables for the cross-process execution lane at
 * {@link ./local-execution-lock.ts}. Kept separate so the logic file stays
 * logic-only.
 */

/** Directory under {@link getDataDir()} holding the lane's committed generations. */
export const LANE_DIR_NAME = "local-execution-lane";

/** Prefix of a committed generation file: `generation-<zero-padded number>.json`. */
export const GENERATION_FILE_PREFIX = "generation-";

/** Suffix of a committed generation file. */
export const GENERATION_FILE_SUFFIX = ".json";

/** Digits a generation number is zero-padded to, so names sort lexically. */
export const GENERATION_DIGITS = 12;

/** Prefix of a not-yet-committed state file, written in full before it is linked into place. */
export const PENDING_FILE_PREFIX = ".pending-";

/**
 * Committed generations kept behind the newest. A reader lists the directory
 * and then reads the newest file; keeping a tail means a reader that lagged a
 * few commits still finds the file it listed.
 */
export const GENERATIONS_KEPT = 8;

/**
 * Filename of the lock the pre-lane MCP server writes under {@link getDataDir()}.
 * Read only, so a session still running an older server is respected while the
 * machine's sessions upgrade.
 */
export const LEGACY_LOCK_FILE_NAME = "local-execution.lock";

/** How often a caller that chose to wait re-attempts, and so refreshes its place in line. */
export const POLL_INTERVAL_MS = 500;

/** Minimum gap between "waiting for lane" log lines from the same blocked caller. */
export const WAIT_LOG_INTERVAL_MS = 10_000;

/** Attempts a single acquire or release makes when other commits keep winning the race. */
export const MAX_COMMIT_ATTEMPTS = 50;

/** Upper bound of the random pause between commit attempts, spreading out racing writers. */
export const COMMIT_RETRY_JITTER_MS = 20;

/**
 * How long a queued checkout keeps its turn after the lane frees, or after it
 * last asked. A checkout that asked within this window, or whose turn arrived
 * within it, is still served before anyone queued behind it.
 */
export const CLAIM_GRACE_MS = 30_000;

/**
 * A queued checkout that has not asked for this long has stopped waiting; its
 * place in line is dropped.
 */
export const TICKET_ABANDON_MS = 10 * 60_000;

/**
 * A queued checkout's last-asked time is rewritten only once this old, so a
 * caller polling a held lane mostly reads without writing. Well under
 * {@link CLAIM_GRACE_MS}, so a poller never looks absent.
 */
export const TICKET_REFRESH_MS = 5_000;

/** Wait applied by the execute tools when the caller passes none. */
export const DEFAULT_TOOL_LANE_WAIT_MS = 20_000;

/** Longest wait a caller may ask the execute tools for. */
export const MAX_TOOL_LANE_WAIT_MS = 10 * 60_000;

/** Retry delay suggested to a caller turned away from a busy lane. */
export const SUGGESTED_RETRY_AFTER_MS = 30_000;
