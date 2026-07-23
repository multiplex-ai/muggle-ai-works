export enum SlotWatchAction {
  Skip = "skip",
  RecordPendingSignal = "record-pending-signal",
  SpawnTick = "spawn-tick",
}

export enum SlotSkipReason {
  WatcherLive = "watcher-live",
  CycleInProgress = "cycle-in-progress",
  NoSignal = "no-signal",
  AlreadyHandled = "already-handled",
  AwaitingSpawnRetryWindow = "awaiting-spawn-retry-window",
  AwaitingSignalConfirmation = "awaiting-signal-confirmation",
}

export enum SpawnTickReason {
  TerminalPr = "terminal-pr",
  ConfirmedSignal = "confirmed-signal",
  SpawnRetry = "spawn-retry",
}

export enum CiRollupBucket {
  Pass = "pass",
  Fail = "fail",
  Pending = "pending",
  None = "none",
}

export interface SlotPollSnapshot {
  prState: string;
  headSha: string;
  actionableThreadIds: string[];
  actionableBodyReviewIds: number[];
  behindBy: number;
  isConflicting: boolean;
  ciBucket: CiRollupBucket;
}

/** On-disk shape of <slot>/watchdog.json — snake_case like its sibling slot files. */
export interface WatchdogSlotState {
  pending_signature: string | null;
  pending_seen_at: string | null;
  last_spawn_signature: string | null;
  last_spawn_at: string | null;
  spawn_attempts: number;
}

export interface SlotDecisionInput {
  isWatcherLive: boolean;
  isCycleInProgress: boolean;
  pollSnapshot: SlotPollSnapshot;
  signature: string;
  storedSlotState: WatchdogSlotState;
  newestFollowupLogTimestampMs: number | null;
  nowMs: number;
  confirmSignalAfterMs: number;
  spawnRetryAfterMs: number;
}

export interface SlotDecision {
  action: SlotWatchAction;
  skipReason?: SlotSkipReason;
  spawnReason?: SpawnTickReason;
  updatedSlotState?: WatchdogSlotState;
}

export interface ReviewThreadSnapshot {
  threadId: string;
  isResolved: boolean;
  isOutdated: boolean;
  newestCommentBody: string;
}

export interface SubmittedReviewSnapshot {
  reviewId: number;
  reviewState: string;
  lineCommentCount: number;
}
