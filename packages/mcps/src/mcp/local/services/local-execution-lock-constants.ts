/**
 * Tunables for the cross-process single-flight lock at
 * {@link ./local-execution-lock.ts}. Kept separate so the logic file stays
 * logic-only.
 */

import { STOP_REQUEST_GRACE_MS } from "./execution-stop-constants.js";

/** Filename of the lock state file, written under {@link getDataDir()}. */
export const LOCK_FILE_NAME = "local-execution.lock";

/** Suffix appended to the lock file path for the read-modify-write sidecar. */
export const MODIFY_LOCK_SUFFIX = ".modify";

/** How often a blocked caller re-attempts acquire while waiting. */
export const POLL_INTERVAL_MS = 2000;

/** Minimum gap between "waiting for lock" log lines from the same blocked caller. */
export const WAIT_LOG_INTERVAL_MS = 10_000;

/** Backoff between retries when the modify-lock sidecar is held by another acquirer. */
export const MODIFY_LOCK_RETRY_MS = 50;

/** Modify-lock age past which we assume the previous acquirer crashed and reclaim it. */
export const MODIFY_LOCK_STALE_MS = 5_000;

/** A waiter that has not polled for this long has stopped waiting; its place in line is dropped. */
export const WAITER_ABANDON_MS = 5 * POLL_INTERVAL_MS;

/**
 * How long past its own run timeout a holder may keep the lock before it is
 * taken as stuck and the lock passes on: the stop request's grace, then the
 * teardown and result handling after it.
 */
export const HOLD_OVERRUN_GRACE_MS = STOP_REQUEST_GRACE_MS + 3 * 60_000;
