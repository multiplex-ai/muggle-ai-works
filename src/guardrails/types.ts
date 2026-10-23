export interface GuardrailState {
  sessionId: string;
  generation?: number;
  prsHandled: string[];
  unitTestsGreen?: boolean;
  e2eRun?: boolean;
  e2eSkipped?: boolean;
  e2eSkipCycleScoped?: boolean;
  e2eBlockCount?: number;
  buildIntentRouted?: boolean;
  terminalPending?: number[];
  terminalHandled?: number[];
  terminalBlockCount?: number;
  watchSkipped?: boolean;
  watchBlockCount?: number;
  buildSkipped?: boolean;
  buildBlockCount?: number;
  walkthroughPosted?: boolean;
  walkthroughSkipped?: boolean;
  walkthroughBlockCount?: number;
  lastInvokedSkillName?: string;
  mandatoryStages?: string[];
  stagesRead?: string[];
  stageSkipped?: boolean;
  stageBlockCount?: number;
  classifiedTestCaseIds?: string[];
  classificationSkipped?: boolean;
  failedRuns?: string[];
  debuggedRuns?: string[];
  debugSkipped?: boolean;
  debugBlockCount?: number;
  commentReplySkipped?: boolean;
  commentReplyBlockCount?: number;
  capabilityClaimNudged?: boolean;
  e2eReleased?: boolean;
  terminalReleased?: boolean;
  watchReleased?: boolean;
  walkthroughReleased?: boolean;
  commentReplyReleased?: boolean;
  stageReleased?: boolean;
  debugReleased?: boolean;
}

/** Outcome of the mandatory-stage Stop gate for a turn end. */
export enum StageGateAction {
  Block = "block",
  Release = "release",
  None = "none",
}

/** A mandatory-stage gate decision: the action, the running block count, and the declared stage files still unread. */
export interface StageGateDecision {
  action: StageGateAction;
  blockCount: number;
  unread: string[];
}

/** Whether the pre-execution-classification gate lets an execution through, and the test case it judged. */
export interface ClassificationGateDecision {
  deny: boolean;
  testCaseId?: string;
}

/** Outcome of the debug-path Stop gate for a turn end. */
export enum DebugGateAction {
  Block = "block",
  Release = "release",
  None = "none",
}

/** A debug-path gate decision: the action, the running block count, and the failed runs with no debug evidence. */
export interface DebugGateDecision {
  action: DebugGateAction;
  blockCount: number;
  undebugged: string[];
}

/** Outcome of the walkthrough-post Stop gate for a turn end. */
export enum WalkthroughGateAction {
  Block = "block",
  Release = "release",
  None = "none",
}

/** A walkthrough gate decision: the action, the running block count, and the PR urls still missing a walkthrough. */
export interface WalkthroughGateDecision {
  action: WalkthroughGateAction;
  blockCount: number;
  owed: string[];
}

/** A walkthrough scan finished off the hook path, with the session's handled PRs it was run for. */
export interface CachedWalkthroughScan {
  prsHandled: string[];
  owed: string[];
  verified: string[];
}

/** Work a hook hands to a detached run of the guardrails CLI, because it waits on the network. */
export enum GuardrailBackgroundJob {
  ScanWalkthroughs = "scan-walkthroughs",
  ReserveWalkthroughComment = "reserve-walkthrough-comment",
  SettleWalkthroughSkipped = "settle-walkthrough-skipped",
  SettleWalkthroughUnreasoned = "settle-walkthrough-unreasoned",
  SettleWalkthroughNoAppLogicChange = "settle-walkthrough-no-app-logic-change",
  ScanWatchPrStates = "scan-watch-pr-states",
}

/** Outcome of the watcher-arm Stop gate for a turn end. */
export enum WatchGateAction {
  Block = "block",
  Release = "release",
  None = "none",
}

export enum BuildFollowthroughAction {
  Block = "block",
  Release = "release",
  None = "none",
}

export interface BuildFollowthroughDecision {
  action: BuildFollowthroughAction;
  blockCount: number;
}

/** A watcher-arm gate decision: the action, the running block count, and the opened PR urls that still owe a live watch. */
export interface WatchGateDecision {
  action: WatchGateAction;
  blockCount: number;
  unwatched: string[];
}

/** What one muggle-do session slot says about the watch on its PR. */
export enum WatchSlotStatus {
  Live = "live",
  Terminal = "terminal",
  Stopped = "stopped",
  Stale = "stale",
}

/** The on-disk facts the watcher-arm gate reads from one session slot. */
export interface WatchSlotEvidence {
  isStopped: boolean;
  isFinalized: boolean;
  recordedPrState?: string;
  heartbeatMtimeMs?: number;
}

/** A PR's state as the provider reports it, or that the lookup could not reach the provider. */
export enum ProviderPrState {
  Open = "OPEN",
  Merged = "MERGED",
  Closed = "CLOSED",
  Unreachable = "UNREACHABLE",
}

/** The last provider lookup of a session's unwatched PRs, keyed by PR url. */
export interface CachedPrStateScan {
  states: Record<string, ProviderPrState>;
}

export enum PrTerminalVerdict {
  Merged = "merged",
  Closed = "closed",
}

export interface PrTerminalEvent {
  prNumber: number;
  verdict: PrTerminalVerdict;
}

export enum PrTerminalGateAction {
  Block = "block",
  Release = "release",
  None = "none",
}

export interface PrTerminalGateDecision {
  action: PrTerminalGateAction;
  blockCount: number;
}

/** The forge whose review-thread resolve call a Bash command was about to make. */
export enum ReviewThreadProvider {
  GitHub = "github",
  GitLab = "gitlab",
}

/** Outcome of the comment-reply Stop gate for a turn end. */
export enum CommentReplyGateAction {
  Block = "block",
  Release = "release",
  None = "none",
}

/** A comment-reply gate decision: the action, the running block count, and the review comments still awaiting a threaded reply. */
export interface CommentReplyGateDecision {
  action: CommentReplyGateAction;
  blockCount: number;
  unanswered: string[];
}

export interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: ToolInput;
  // `content` is unknown because an MCP tool's result is structured — usually an
  // array of typed parts, not a string. Readers must narrow rather than assume.
  tool_response?: { stdout?: string; stderr?: string; output?: string; content?: unknown };
  prompt?: string;
  // The closing message of the turn a Stop hook judges. Codex always sends it;
  // Claude Code may omit it, so a gate that judges what the user was actually
  // told falls back to reading the turn out of the JSONL transcript.
  last_assistant_message?: string;
  transcript_path?: string;
}

/** The subset of tool inputs the guardrails read. Indexed because the Skill tool's skill-name key differs by harness version (see SKILL_NAME_INPUT_KEYS). */
export interface ToolInput {
  command?: string;
  skill?: string;
  skillName?: string;
  name?: string;
  file_path?: string;
  eventType?: string;
  testCaseId?: string;
  runId?: string;
  testCase?: { id?: string };
  testScript?: { testCaseId?: string };
}

/** Any one hook response a guardrail handler emits, parsed back so several can be merged into one. */
export interface GuardrailHookOutput {
  decision?: string;
  reason?: string;
  additional_context?: string;
  hookSpecificOutput?: {
    hookEventName?: string;
    additionalContext?: string;
    permissionDecision?: string;
    permissionDecisionReason?: string;
  };
}
