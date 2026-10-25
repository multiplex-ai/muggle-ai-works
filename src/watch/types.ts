import type { ProviderPrState } from "../guardrails/types.js";

/** The coding agent a work session belongs to. */
export enum WorkSessionAgent {
  Claude = "claude",
  Codex = "codex",
}

/** How Claude hosts a session: a daemon-managed background job or a terminal the user drives. */
export enum ClaudeSessionKind {
  Background = "background",
  Interactive = "interactive",
}

/** Whether a Claude session has a turn in flight, as `claude agents --json` reports it. */
export enum ClaudeTurnStatus {
  Busy = "busy",
  Idle = "idle",
  Waiting = "waiting",
}

/** A background job's overall state, as `claude agents --json` reports it. */
export enum ClaudeJobState {
  Working = "working",
  Blocked = "blocked",
  Done = "done",
}

/** One Claude or Codex session the watch can see. */
export interface WorkSession {
  agent: WorkSessionAgent;
  sessionId: string;
  /** The id `claude respawn` takes; Claude only. */
  shortId?: string;
  name?: string;
  cwd?: string;
  kind?: ClaudeSessionKind;
  turnStatus?: ClaudeTurnStatus;
  jobState?: ClaudeJobState;
  startedAtMs?: number;
  /** Codex only: when its rollout file was last written. */
  lastActivityAtMs?: number;
  /** Claude only: joined from the `~/.claude/sessions/<pid>.json` registry. */
  pid?: number;
}

/** The process kinds the watch reports on. */
export enum TrackedProcessKind {
  ClaudeCli = "claude-cli",
  CodexCli = "codex-cli",
  MuggleMcpServer = "muggle-mcp-server",
  PrWatchLoop = "pr-watch-loop",
}

/** One row of the OS process table, before classification. */
export interface ProcessTableEntry {
  pid: number;
  parentPid: number;
  /** Executable file name, lower-cased with any `.exe` stripped, e.g. `node` or `bash`. */
  executableName: string;
  /** Present only for executables whose command lines the lister keeps; empty otherwise. */
  commandLine: string;
  ageMs?: number;
}

/** A process the watch tracks, with what its kind needs to be judged. */
export interface TrackedProcess {
  pid: number;
  parentPid: number;
  kind: TrackedProcessKind;
  ageMs?: number;
  /**
   * True when an ancestor died before the chain reached a Claude or Codex process.
   * Undefined for PR watch loops: Git Bash's exec breaks their Windows parent
   * chain even while the loop is healthy, so ancestry says nothing about them.
   */
  isOrphaned?: boolean;
  /** PR watch loops only: the slot dir name its `--slot` argument names. */
  watchSlotSlug?: string;
}

/** An open PR a PR-watch slot is responsible for. */
export interface SlotPr {
  repo: string;
  number: number;
  url: string;
  headSha?: string;
}

/** What a PR-watch slot's files say, for a slot that still owes a watch. */
export interface WatchSlotRecord {
  slug: string;
  slotDir: string;
  ownerSessionId?: string;
  heartbeatMtimeMs?: number;
  /** Whether the slot opted into out-of-session recovery via `watch-registration.json`. */
  isRegistered: boolean;
  openPrs: SlotPr[];
}

/** The contents of a slot's `watch-registration.json`. */
export interface WatchSlotRegistration {
  registered_at: string;
  registered_by: string;
}

/** GitHub's `mergeable` verdict for a PR. */
export enum PrMergeable {
  Mergeable = "MERGEABLE",
  Conflicting = "CONFLICTING",
  Unknown = "UNKNOWN",
}

/** GitHub's `mergeStateStatus` for a PR. */
export enum PrMergeStateStatus {
  Behind = "BEHIND",
  Blocked = "BLOCKED",
  Clean = "CLEAN",
  Dirty = "DIRTY",
  Draft = "DRAFT",
  HasHooks = "HAS_HOOKS",
  Unknown = "UNKNOWN",
  Unstable = "UNSTABLE",
}

/** GitHub's combined check state for a commit. */
export enum CiRollupState {
  Success = "SUCCESS",
  Failure = "FAILURE",
  Error = "ERROR",
  Pending = "PENDING",
  Expected = "EXPECTED",
}

/** A PR's live state as GitHub reports it. */
export interface PrLiveStatus {
  url: string;
  state: ProviderPrState;
  headSha?: string;
  mergeable?: PrMergeable;
  mergeStateStatus?: PrMergeStateStatus;
  ciRollup?: CiRollupState;
  unresolvedThreadCount: number;
}

/** Whether a slot's watch loop is delivering events to a session. */
export enum WatcherLiveness {
  Polling = "polling",
  /** No loop right now, but the heartbeat is recent: a rollover hand-off in progress. */
  Rearming = "rearming",
  Deaf = "deaf",
  Dead = "dead",
}

/** One open PR's slot, judged: who watches it, whether that watch is heard, and what GitHub says. */
export interface WatchSlotAssessment {
  slug: string;
  slotDir: string;
  pr: SlotPr;
  isRegistered: boolean;
  watcher: WatcherLiveness;
  loopPid?: number;
  loopAgeMs?: number;
  heartbeatAgeMs?: number;
  ownerSessionId?: string;
  /** Undefined when the owner is unknown or the session listing could not be read. */
  isOwnerSessionActive?: boolean;
  live?: PrLiveStatus;
}

/** How loudly a finding is surfaced: alerts notify, warnings and notices only land in the ledger. */
export enum WatchFindingSeverity {
  Alert = "alert",
  Warning = "warning",
  Notice = "notice",
}

/** Every condition the watch reports. */
export enum WatchFindingCode {
  WatcherDead = "WATCHER_DEAD",
  WatcherDeaf = "WATCHER_DEAF",
  CiFailing = "CI_FAILING",
  BaseConflict = "BASE_CONFLICT",
  BehindBase = "BEHIND_BASE",
  ReviewThreadsUnresolved = "REVIEW_THREADS_UNRESOLVED",
  PrStatusUnavailable = "PR_STATUS_UNAVAILABLE",
  OrphanedMcpServer = "ORPHANED_MCP_SERVER",
  SlotTerminalUnfinalized = "SLOT_TERMINAL_UNFINALIZED",
}

/** One condition the watch found this tick. `key` is stable for as long as the condition is the same one. */
export interface WatchFinding {
  key: string;
  code: WatchFindingCode;
  severity: WatchFindingSeverity;
  /** What the finding is about, e.g. `multiplex-ai/muggle-ai-works#547` or `pid 4120`. */
  subject: string;
  message: string;
}

/** Where one owner session's watcher recovery stands this tick. */
export enum WatcherRecoveryOutcome {
  /** Planned and not yet run; the executor turns it into one of the outcomes below. */
  ResumeDue = "resume-due",
  Resumed = "resumed",
  ResumeFailed = "resume-failed",
  CoolingDown = "cooling-down",
  AttemptsExhausted = "attempts-exhausted",
  DeferredByTickCap = "deferred-by-tick-cap",
  TranscriptMissing = "transcript-missing",
}

/** One owner session whose registered slots have dead watchers, and what the watch did about it. */
export interface WatcherRecovery {
  ownerSessionId: string;
  slotSlugs: string[];
  outcome: WatcherRecoveryOutcome;
  cwd?: string;
}

/** Recoveries carried out, the resume attempts to record, and the events to log. */
export interface ExecutedRecoveries {
  recoveries: WatcherRecovery[];
  attemptsByOwner: Record<string, string[]>;
  events: WatchEvent[];
}

/** What the reload fan-out does with one session. */
export enum ReloadAction {
  Respawn = "respawn",
  Defer = "defer",
  NotifyManual = "notify-manual",
  Skip = "skip",
}

/** The fan-out's decision for one Claude session, with the reason shown to the user. */
export interface ReloadDecision {
  sessionId: string;
  shortId?: string;
  name?: string;
  action: ReloadAction;
  reason: string;
}

/** What one reload pass decided and did. */
export interface ReloadReport {
  decisions: ReloadDecision[];
  respawnedSessionIds: string[];
  failedSessionIds: string[];
}

/** A plugin change the fan-out is still working through. */
export interface PendingReload {
  fingerprint: string;
  /** Sessions started at or after this already loaded the new plugins. */
  changedAtMs: number;
  respawnedSessionIds: string[];
  notifiedSessionIds: string[];
}

/** The installed user-scope plugins, reduced to what identifies a change. */
export interface PluginFingerprint {
  fingerprint: string;
  /** The newest `lastUpdated` among them, or undefined when none carries one. */
  changedAtMs?: number;
}

/** A finding that was active at the end of the last tick. */
export interface ActiveFindingRecord {
  code: WatchFindingCode;
  severity: WatchFindingSeverity;
  subject: string;
  message: string;
  firstSeenAt: string;
}

/** A PR GitHub last reported merged or closed, so later ticks can skip asking until a recheck is due. */
export interface TerminalPrRecord {
  state: ProviderPrState;
  checkedAt: string;
}

/** How the active findings moved between the last tick and this one. */
export interface FindingTransitions {
  activeFindings: Record<string, ActiveFindingRecord>;
  raised: WatchFinding[];
  cleared: Array<{ key: string; record: ActiveFindingRecord }>;
}

/** What the watch carries from one tick to the next. */
export interface WatchLedgerState {
  activeFindings: Record<string, ActiveFindingRecord>;
  /** ISO timestamps of resume attempts, per owner session id. */
  recoveryAttemptsByOwner: Record<string, string[]>;
  /** PRs GitHub reported terminal while their slot still lists them open, keyed by PR url. */
  terminalPrsByUrl: Record<string, TerminalPrRecord>;
  pluginFingerprint?: string;
  pendingReload?: PendingReload;
}

/** The kinds of line `events.jsonl` holds. */
export enum WatchEventKind {
  Raised = "raised",
  Cleared = "cleared",
  Resumed = "resumed",
  ResumeFailed = "resume-failed",
  ReloadRequested = "reload-requested",
  Respawned = "respawned",
  RespawnFailed = "respawn-failed",
}

/** One line of `events.jsonl`. */
export interface WatchEvent {
  at: string;
  kind: WatchEventKind;
  key?: string;
  code?: WatchFindingCode;
  subject?: string;
  message?: string;
}

/** Everything one tick saw and did, as `status.json` stores it. */
export interface WatchSnapshot {
  takenAt: string;
  sessions: WorkSession[];
  processes: TrackedProcess[];
  slots: WatchSlotAssessment[];
  findings: WatchFinding[];
  recoveries: WatcherRecovery[];
  reload?: ReloadReport;
}

/** Where the watch reads its sources and keeps its ledger. */
export interface WatchPaths {
  watchDir: string;
  slotsDir: string;
  claudeSessionRegistryDir: string;
  claudeProjectsDir: string;
  claudeInstalledPluginsFile: string;
  codexSessionsDir: string;
}

/** A finished child process: its exit code and captured stdout. */
export interface CommandOutcome {
  exitCode: number;
  stdout: string;
}

/** Where a spawned command runs. */
export interface CommandOptions {
  cwd?: string;
}

/** Runs an executable with no shell and no window; null when it could not start or timed out. */
export type CommandRunner = (
  executable: string,
  args: string[],
  options?: CommandOptions,
) => CommandOutcome | null;

/** Shows one desktop notification. Best-effort: the implementation swallows its own failures. */
export type DesktopNotifier = (title: string, lines: string[]) => void;

/** The side-effecting edges a tick runs through, injected so the logic is testable. */
export interface WatchTickDeps {
  nowMs: number;
  platform: NodeJS.Platform;
  paths: WatchPaths;
  runCommand: CommandRunner;
  notify: DesktopNotifier;
  isAutoReloadEnabled: boolean;
  isRecoveryEnabled: boolean;
}
