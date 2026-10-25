/**
 * Types for the cross-process execution lane at
 * {@link ./local-execution-lock.ts}. Kept separate so the logic file stays
 * logic-only.
 */

/** The checkout currently running in the lane. */
export interface ILaneHolder {
  /** Normalized absolute cwd of the checkout that holds the lane. */
  cwd: string;
  /** Process IDs holding it. Several entries = same-checkout reentrant holders. */
  pids: number[];
  /** When this checkout took the lane (ms since epoch). */
  acquiredAt: number;
}

/** A checkout waiting its turn. One per checkout: every caller from it shares the place. */
export interface ILaneTicket {
  /** Normalized absolute cwd of the waiting checkout. */
  cwd: string;
  /** Process ID that last asked on this checkout's behalf. */
  pid: number;
  /** When the checkout first joined the line (ms since epoch). Fixes its place. */
  enqueuedAt: number;
  /** When a caller from the checkout last asked (ms since epoch). */
  lastSeenAt: number;
}

/** Contents of one committed generation file. */
export interface ILaneRecord {
  holder: ILaneHolder | null;
  /** Waiting checkouts, first in line first. */
  queue: ILaneTicket[];
  /** When the lane last became free (ms since epoch); null while held. */
  freedAt: number | null;
}

/** A committed record together with the generation it was read at. */
export interface ILaneSnapshot extends ILaneRecord {
  /** Generation number; 0 when nothing was ever committed. A commit expects it unchanged. */
  generation: number;
}

/** A holder recorded by a pre-lane MCP server's lock file. */
export interface ILegacyLockState {
  holderCwd: string;
  holderPids: number[];
  acquiredAt: number;
}

/** Why a caller was granted the lane. */
export enum LaneGrantReason {
  /** Nobody held it and nobody ahead was still owed a turn. */
  Free = "free",
  /** The caller's own checkout already held it. */
  SameCheckout = "same-checkout",
}

/** Who a turned-away caller is waiting on. */
export interface ILaneBusyDetails {
  /** Checkout running now, or null when the lane is free but owed to a checkout ahead. */
  holderCwd: string | null;
  /** How long the holder has held the lane, in ms; null when nobody holds it. */
  heldForMs: number | null;
  /** The caller's place in line, 1 = next. */
  position: number;
  /** Checkouts in line, the caller included. */
  queueLength: number;
  /** True when the holder is a pre-lane MCP server, which keeps no line. */
  heldByLegacyServer: boolean;
  /** Suggested wait before asking again, in ms. */
  retryAfterMs: number;
}

/** Outcome of one acquire attempt that never waits. */
export type ILaneAttempt =
  | { granted: true; reason: LaneGrantReason; handle: ILocalExecutionLockHandle }
  | { granted: false; busy: ILaneBusyDetails };

/** Result of applying one acquire request to a snapshot; pure, nothing written yet. */
export type ILaneAcquireDecision =
  | { granted: true; reason: LaneGrantReason; next: ILaneRecord }
  | { granted: false; busy: Omit<ILaneBusyDetails, "heldByLegacyServer" | "retryAfterMs">; next: ILaneRecord };

/** Lane state as reported to a status reader, relative to one checkout. */
export interface ILaneStatusReport {
  generation: number;
  holder: ILaneHolder | null;
  queue: ILaneTicket[];
  freedAt: number | null;
  /** A pre-lane server's live holder, when one is recorded. */
  legacyHolder: ILegacyLockState | null;
  /** The asking checkout's relation to the lane, when it named one. */
  relation?: LaneRelation;
  /** The asking checkout's place in line, when it is queued. */
  position?: number;
}

/** How a checkout stands relative to the lane. */
export enum LaneRelation {
  Free = "free",
  HeldByYou = "held-by-you",
  HeldByPeer = "held-by-peer",
}

/**
 * Handle returned to a successful acquirer. Calling `release` exactly once
 * removes this holder and frees the lane when it was the last.
 */
export interface ILocalExecutionLockHandle {
  /** Release the lane. Safe to call once per acquire. */
  release: () => Promise<void>;
}
