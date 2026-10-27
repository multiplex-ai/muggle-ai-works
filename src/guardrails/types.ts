import type { DeclaredSkip } from "../e2e-skip/types.js";

/**
 * One change a PR or a skip belongs to: a repo, keyed provider-neutrally, and a branch in it.
 *
 * Output shape: `{ repo: "github.com/acme/web", branch: "users/me/fix-login" }`
 */
export interface ChangeIdentity {
  repo: string;
  branch: string;
}

export interface GuardrailState {
  sessionId: string;
  generation?: number;
  prsHandled: string[];
  unitTestsGreen?: boolean;
  e2eRun?: boolean;
  e2eSkipped?: boolean;
  e2eSkipCycleScoped?: boolean;
  /**
   * The latest accepted environment skip, kept so the PRs of the change it was
   * verified for carry it: one opened later for the same change is settled
   * with it, and the walkthrough gate holds the turn until each covered PR's
   * comment shows it.
   */
  e2eSkipDeclaration?: DeclaredSkip;
  /** The change `e2eSkipDeclaration` was verified for: its working tree's repo and checked-out branch. */
  e2eSkipVerifiedChange?: ChangeIdentity;
  /** Every PR a skip has been applied to this session; a skip marker on one of these settles it. */
  e2eSkipCoveredPrs?: string[];
  /** The change behind each PR this session opened, recorded only when its head branch was known. */
  prChanges?: Record<string, ChangeIdentity>;
  /** Every PR in play was last seen carrying the skip's record; a PR opened since clears it. */
  e2eSkipSettledOnPrs?: boolean;
  e2eBlockCount?: number;
  buildIntentRouted?: boolean;
  terminalPending?: number[];
  terminalHandled?: number[];
  terminalBlockCount?: number;
  watchSkipped?: boolean;
  watchBlockCount?: number;
  watchFollowThroughBlockCount?: number;
  watchHeldPrNumbers?: number[];
  buildSkipped?: boolean;
  buildBlockCount?: number;
  walkthroughPostedAt?: number;
  walkthroughPostedPrUrls?: string[];
  walkthroughsVerified?: boolean;
  walkthroughSkipped?: boolean;
  e2eDelegations?: E2eDelegation[];
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

/** An acceptance-tester launched into the background to run E2E, and the PRs its brief names. */
export interface E2eDelegation {
  dispatchedAt: number;
  prUrls: string[];
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

/** A walkthrough scan finished off the hook path, with the session's handled PRs it was run for and when it began. */
export interface CachedWalkthroughScan {
  prsHandled: string[];
  owed: string[];
  verified: string[];
  startedAt?: number;
}

/** Work a hook hands to a detached run of the guardrails CLI, because it waits on the network or on a contended lock. */
export enum GuardrailBackgroundJob {
  ScanWalkthroughs = "scan-walkthroughs",
  ReserveWalkthroughComment = "reserve-walkthrough-comment",
  SettleWalkthroughSkipped = "settle-walkthrough-skipped",
  SettleBranchWalkthroughSkipped = "settle-branch-walkthrough-skipped",
  SettleWalkthroughUnreasoned = "settle-walkthrough-unreasoned",
  SettleWalkthroughNoAppLogicChange = "settle-walkthrough-no-app-logic-change",
  ScanWatchPrStates = "scan-watch-pr-states",
  CommitDeferredState = "commit-deferred-state",
}

/** A test run one tool call stands for, as the E2E gate folds it into session state. */
export interface RecordedRun {
  unitTestPassed?: boolean;
  e2eRan?: boolean;
  e2eSkipped?: boolean;
  e2eSkipCycleScoped?: boolean;
}

/** Which recorded change a {@link StateMutation} carries. */
export enum StateMutationKind {
  ToolOutcome = "tool-outcome",
  SkillInvocation = "skill-invocation",
  PrOpened = "pr-opened",
  E2eDelegation = "e2e-delegation",
  WatchFollowThrough = "watch-follow-through",
  Fields = "fields",
}

/**
 * What one observed tool call records: its test run, an accepted E2E skip and the change it was verified
 * for, the skip markers it carried, a posted walkthrough and when, a failed Muggle run.
 */
export interface ToolOutcomeMutation {
  kind: StateMutationKind.ToolOutcome;
  run: RecordedRun;
  acceptedSkip: DeclaredSkip | null;
  /** Set only for an environment skip declared from a working tree whose change could be resolved. */
  skipVerifiedChange?: ChangeIdentity;
  isWatchSkip: boolean;
  isBuildSkip: boolean;
  isWalkthroughPosted: boolean;
  walkthroughPostedAt: number;
  walkthroughPostTargets: string[];
  isWalkthroughSkip: boolean;
  failedRunId?: string;
}

/** A PR the session just opened, and the change it belongs to when its head branch is known. */
export interface PrOpenedMutation {
  kind: StateMutationKind.PrOpened;
  prUrl: string;
  prChange?: ChangeIdentity;
}

/** An acceptance run handed to a background agent. */
export interface E2eDelegationMutation {
  kind: StateMutationKind.E2eDelegation;
  delegation: E2eDelegation;
}

/** The PRs the user held from watcher follow-through, and the gate's block count for this turn end. */
export interface WatchFollowThroughMutation {
  kind: StateMutationKind.WatchFollowThrough;
  heldPrNumbers: number[];
  blockCount: number;
}

/** A skill the session invoked, the mandatory stage files it declares, and the run its emit stands for. */
export interface SkillInvocationMutation {
  kind: StateMutationKind.SkillInvocation;
  skillName: string;
  stagePaths: string[];
  emittedRun: RecordedRun;
}

/** Top-level fields set to fixed values, such as a gate's release stamp or its block count. */
export interface FieldsMutation {
  kind: StateMutationKind.Fields;
  fields: Partial<GuardrailState>;
}

/**
 * A session-state change as data rather than a closure, so a write that cannot take the session's
 * lock within a hook's wait can be persisted and committed later instead of being lost.
 */
export type StateMutation =
  | ToolOutcomeMutation
  | SkillInvocationMutation
  | PrOpenedMutation
  | E2eDelegationMutation
  | WatchFollowThroughMutation
  | FieldsMutation;

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

/** The watcher dispatch a slot's due work calls for. */
export enum OwedWatchWorkKind {
  Rebase = "rebase",
  FixCi = "fix-ci",
}

/** One piece of work a watch this session owns found due and nothing ever attempted. */
export interface OwedWatchWork {
  kind: OwedWatchWorkKind;
  slug: string;
  prUrl: string;
  prNumber: number;
  /** The `<head>..<base-tip>` key a rebase is due on, or the head whose CI is red. */
  dueOn: string;
}

/** Outcome of the watcher follow-through Stop gate. It has no release: only an attempt, a new head, or the user's hold clears it. */
export enum WatchFollowThroughAction {
  Block = "block",
  None = "none",
}

/** A follow-through gate decision: the action, the running block count, and the owed work not under a user hold. */
export interface WatchFollowThroughDecision {
  action: WatchFollowThroughAction;
  blockCount: number;
  owed: OwedWatchWork[];
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
  subagent_type?: string;
  prompt?: string;
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
