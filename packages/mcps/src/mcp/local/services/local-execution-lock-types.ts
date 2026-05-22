/**
 * Types for the cross-process single-flight lock at
 * {@link ./local-execution-lock.ts}. Kept separate so the logic file stays
 * logic-only.
 */

/**
 * On-disk shape of the lock state. Persisted as JSON at
 * `<dataDir>/local-execution.lock`.
 */
export interface ILockState {
  /** Absolute cwd of the worktree that holds the lock. */
  holderCwd: string;
  /** Process IDs currently holding the lock. Multiple entries = same-cwd reentrant holders. */
  holderPids: number[];
  /** Acquisition timestamp (ms since epoch). For diagnostics only. */
  acquiredAt: number;
}

/**
 * Handle returned to a successful acquirer. Calling `release` exactly once
 * decrements the holder count and deletes the lock file when it reaches zero.
 */
export interface ILocalExecutionLockHandle {
  /** Release the lock. Safe to call once per acquire. */
  release: () => Promise<void>;
}

/**
 * Outcome of a single non-blocking acquire attempt. Internal to the lock
 * module — callers should use {@link acquireLocalExecutionLock} which retries
 * on contention.
 */
export interface ITryAcquireOutcome {
  acquired: boolean;
  blockingState?: ILockState;
}
