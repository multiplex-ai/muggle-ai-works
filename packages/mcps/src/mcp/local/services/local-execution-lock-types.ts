/**
 * Types for the cross-process single-flight lock at
 * {@link ./local-execution-lock.ts}. Kept separate so the logic file stays
 * logic-only.
 */

import type { IQueuePlace } from "../../../shared/queue-priority/queue-priority-types.js";

/** A caller waiting for the lock. It keeps its place only while it polls and its process lives. */
export interface ILockWaiter extends IQueuePlace {
  /** Normalized cwd of the waiting checkout. */
  cwd: string;
  /** MCP server process waiting. */
  pid: number;
  /** Its last attempt (ms since epoch). */
  lastPolledAt: number;
}

/**
 * On-disk shape of the lock state. Persisted as JSON at
 * `<dataDir>/local-execution.lock`.
 */
export interface ILockState {
  /** Absolute cwd of the worktree that holds the lock; empty while only waiters are recorded. */
  holderCwd: string;
  /** Process IDs currently holding the lock. Multiple entries = same-cwd reentrant holders. */
  holderPids: number[];
  /** Acquisition timestamp (ms since epoch). For diagnostics only. */
  acquiredAt: number;
  /**
   * When the holders' runs must have ended (ms since epoch). Past it a holder
   * whose process lives is taken as stuck and the lock passes on. Absent from
   * state an older writer committed.
   */
  holdDeadlineAt?: number;
  /** Callers waiting, in the order they are served. Absent from state an older writer committed. */
  waiters?: ILockWaiter[];
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
  /** The caller's place in the waiting line when not acquired, 1 = next. */
  position?: number;
}
