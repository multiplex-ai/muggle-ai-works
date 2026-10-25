/** Types for the local service-stack ledger at {@link ./service-stack.ts}. */

/** One port a checkout's E2E run needs served, and the code that must serve it. */
export interface IStackNeed {
  port: number;
  /** Absolute directory the service must run from. */
  runDir: string;
  /** Commit the service must serve. */
  headSha: string;
}

/** A need as a caller states it; the commit defaults to what the directory has checked out. */
export interface IStackNeedRequest {
  port: number;
  runDir: string;
  headSha?: string;
}

/** A checkout's standing claim on the ports it needs, shared with every checkout that needs the same code there. */
export interface IStackLease {
  /** Checkout root of the claiming session. */
  cwd: string;
  /** Free-text name a session gives itself, shown to peers. */
  label?: string;
  needs: IStackNeed[];
  grantedAt: number;
  /** Last claim, check or run that renewed it (ms since epoch). */
  lastSeenAt: number;
}

/** A checkout waiting for ports another lease holds. One per checkout. */
export interface IStackTicket {
  cwd: string;
  label?: string;
  needs: IStackNeed[];
  /** Fixes the checkout's place in line. */
  enqueuedAt: number;
  lastSeenAt: number;
}

/** Contents of one committed ledger generation. */
export interface IStackRecord {
  leases: IStackLease[];
  /** Waiting checkouts, first in line first. */
  queue: IStackTicket[];
  /** When each port last stopped being needed by any lease (ms since epoch), keyed by port. */
  portFreedAt: Record<string, number>;
}

/** A service prepare started and recorded, with its process still alive. */
export interface ITrackedService {
  name: string;
  /** Directory it runs from. */
  dir: string;
  port: number;
  pid: number;
  /** Commit its checkout had out when it started. */
  headSha: string | null;
  /** Checkout root whose tracking file records it. */
  source: string;
}

/** Result of applying one claim to the ledger, before anything is written. */
export interface IStackClaimDecision {
  isGranted: boolean;
  next: IStackRecord;
  blockers: IStackBlocker[];
  sharedWith: string[];
  position: number | null;
  queueLength: number;
  retryAfterMs: number | null;
}

/** Whether a claim may proceed. */
export enum StackClaimVerdict {
  /** Every needed port is the caller's to keep, start or restart. */
  Granted = "GRANTED",
  /** A needed port is leased to different code, or owed to a checkout ahead in line. */
  Busy = "BUSY",
}

/** What a granted claim does with one port. */
export enum StackPortAction {
  /** A tracked service already serves the needed directory and commit. */
  Keep = "keep",
  /** No tracked service serves the port; start it. */
  Start = "start",
  /** A tracked service serves other code that no lease needs; replace it. */
  Restart = "restart",
}

/** A granted claim's instruction for one port. */
export interface IStackPortPlan extends IStackNeed {
  action: StackPortAction;
  /** The tracked service on the port now, when there is one. */
  current: ITrackedService | null;
}

/** Why a claim cannot have a port yet. */
export interface IStackBlocker {
  port: number;
  /** Checkout that holds, or is ahead in line for, different code on the port. */
  blockingCwd: string;
  blockingLabel?: string;
  /** True when the blocker is waiting ahead in line rather than holding a lease. */
  isQueuedAhead: boolean;
  /** Code the blocker needs on the port. */
  needsRunDir: string;
  needsHeadSha: string;
  /** How long the blocker has held its lease; null for a checkout ahead in line. */
  heldForMs: number | null;
}

/** Answer to one claim. */
export interface IStackClaimReport {
  verdict: StackClaimVerdict;
  cwd: string;
  /** Ledger generation the answer was decided against. */
  generation: number;
  /** Per-port instructions; empty unless granted. */
  plan: IStackPortPlan[];
  blockers: IStackBlocker[];
  /** Other checkouts holding a lease on one of the same ports, needing the same code. */
  sharedWith: string[];
  /** The caller's place in line when busy, 1 = next. */
  position: number | null;
  queueLength: number;
  /** Suggested wait before asking again, when busy. */
  retryAfterMs: number | null;
}

/** Whether a run may trust the stack it is about to hit. */
export enum StackCheckVerdict {
  /** The caller's lease holds and every needed port serves its code. */
  Valid = "VALID",
  /** The caller holds no lease; nothing to check against. */
  NoLease = "NO_LEASE",
  /** The caller's lease holds, but a needed port now serves other code. */
  Stale = "STALE",
  /** The target port is leased to a different checkout's code, and the caller holds no claim on it. */
  PeerLease = "PEER_LEASE",
}

/** A needed port serving something other than what the lease needs. */
export interface IStackMismatch {
  need: IStackNeed;
  /** The tracked service serving it now; null when nothing tracked is alive there. */
  actual: ITrackedService | null;
}

/** Answer to one check. */
export interface IStackCheckReport {
  verdict: StackCheckVerdict;
  cwd: string;
  reason: string;
  generation: number;
  mismatches: IStackMismatch[];
  /** The lease that owns the target port, for `PEER_LEASE`. */
  peerLease: IStackLease | null;
}

/** The whole ledger, as reported to a status reader. */
export interface IStackStatusReport {
  generation: number;
  leases: IStackLease[];
  queue: IStackTicket[];
  services: ITrackedService[];
}
