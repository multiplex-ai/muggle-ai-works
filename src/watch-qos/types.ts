/**
 * What a watch quality-of-service record observed about one PR or one CI head.
 *
 * Mirrors `WatchQosSignal` in `@muggleai/telemetry` value for value: the hook and loop bundles carry node builtins
 * only, so they cannot import the telemetry package, and the uploader maps each value back onto it.
 */
export enum WatchQosSignal {
  PrOpened = "pr-opened",
  WatchArmed = "watch-armed",
  WatchMissed = "watch-missed",
  WatchSkipped = "watch-skipped",
  WatcherDown = "watcher-down",
  WatcherRecovered = "watcher-recovered",
  CiRedObserved = "ci-red-observed",
  CiRedHandled = "ci-red-handled",
  CiRedLate = "ci-red-late",
  CiRedCaughtAtTurnEnd = "ci-red-caught-at-turn-end",
  MergedRed = "merged-red",
  ClosedRed = "closed-red",
}

/** The component that recorded a signal; mirrors `WatchQosDetector` in `@muggleai/telemetry`. */
export enum WatchQosDetector {
  TurnEndGate = "turn-end-gate",
  FollowThroughGate = "follow-through-gate",
  WatchService = "watch-service",
  WatchLoop = "watch-loop",
  Cleanup = "cleanup",
}

/** The coding-agent host a signal was recorded under; mirrors `AgentHost` in `@muggleai/telemetry`. */
export enum WatchQosHost {
  ClaudeCode = "claude-code",
  Codex = "codex",
}

/** One signal a detector decided on, before its identities are hashed. */
export interface WatchQosObservation {
  signal: WatchQosSignal;
  detector: WatchQosDetector;
  /** The PR as `owner/repo#n`, or its URL when it is not a GitHub PR. */
  prReference: string;
  /** The head commit SHA, for CI signals. */
  headSha?: string;
  /** Seconds from the triggering moment to detection. */
  delaySeconds?: number;
  host: WatchQosHost;
  /**
   * Tells apart repeat episodes of one signal on one PR and head, such as a watcher that goes down twice. Kept in the
   * ledger only, never uploaded.
   */
  occurrenceKey?: string;
}

/**
 * One line of the local ledger: an observation with its identities hashed per install.
 *
 * Output shape: `{ at: "2026-11-17T10:00:00.000Z", signal: "ci-red-observed", detector: "watch-loop", subjectId: "9f2c…", headId: "41ab…", host: "claude-code" }`
 */
export interface WatchQosLedgerRecord {
  at: string;
  signal: WatchQosSignal;
  detector: WatchQosDetector;
  subjectId: string;
  headId?: string;
  delaySeconds?: number;
  host: WatchQosHost;
  occurrenceKey?: string;
}

/** The files the ledger keeps: the live ledger, its rotated predecessor, and the upload cursor. */
export interface WatchQosPaths {
  ledgerFile: string;
  rotatedLedgerFile: string;
  cursorFile: string;
}

/** The upload cursor: how many bytes of the live ledger were already handed to telemetry. */
export interface WatchQosCursor {
  offset: number;
}

/** The complete ledger lines past the cursor: where reading started, each line's record, and the offset past the last. */
export interface WatchQosPendingRecords {
  startOffset: number;
  records: Array<{ record: WatchQosLedgerRecord | undefined; endOffset: number }>;
  endOffset: number;
}

/** What the uploader needs from the telemetry client, injected so a test drives it without a connection. */
export interface WatchQosUploadDeps {
  paths: WatchQosPaths;
  /** Whether the user allows telemetry at all; an opted-out ledger is consumed without sending. */
  isTelemetryEnabled: () => boolean;
  /** Whether this process has a telemetry client to send through; without one the cursor stays put. */
  isTelemetryReady: () => boolean;
  /** Hands one record to telemetry; false or a throw stops the pass. */
  sendRecord: (record: WatchQosLedgerRecord) => boolean;
}

/** How one upload pass ended. */
export enum WatchQosUploadOutcome {
  Sent = "sent",
  OptedOut = "opted-out",
  TelemetryUnavailable = "telemetry-unavailable",
  NothingPending = "nothing-pending",
}

/** One upload pass: its outcome, how many records went out, and how many were consumed without sending. */
export interface WatchQosUploadReport {
  outcome: WatchQosUploadOutcome;
  sentCount: number;
  skippedCount: number;
}
