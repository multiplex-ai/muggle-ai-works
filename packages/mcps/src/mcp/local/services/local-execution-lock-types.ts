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
  /**
   * Runs counted again after their Studio session wait while another checkout held the lock. They keep
   * other checkouts out until they end. Absent from state an older writer committed.
   */
  resumedHolders?: ILockResumedHolder[];
}

/** A run counted again after its Studio session wait, beside another checkout's holders. */
export interface ILockResumedHolder {
  /** Normalized cwd of the run's checkout. */
  cwd: string;
  /** MCP server process running it. */
  pid: number;
  /** Past this (ms since epoch) a live run is taken as stuck and stops counting. */
  holdDeadlineAt: number;
}

/** Where a lock handle's run counts in the lock state. */
export enum LockHoldStateEnum {
  /** Counted among the holders. */
  Holding = "holding",
  /** Its Studio waits for its session; not counted, so another run may start. */
  YieldedForSessionWait = "yieldedForSessionWait",
  /** Counted again after its session wait, beside another checkout that took the lock meanwhile. */
  ResumedBesidePeer = "resumedBesidePeer",
  Released = "released",
}

/**
 * Handle returned to a successful acquirer. Calling `release` exactly once
 * decrements the holder count and deletes the lock file when it reaches zero.
 */
export interface ILocalExecutionLockHandle {
  /** Release the lock. Safe to call once per acquire. */
  release: () => Promise<void>;
  /** Stop counting the run while its Studio waits for its session, so another run may start meanwhile. */
  yieldForSessionWait: () => Promise<void>;
  /** Count the run again once its Studio holds its session. */
  reclaimAfterSessionWait: () => Promise<void>;
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
