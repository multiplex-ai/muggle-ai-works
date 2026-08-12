export interface GuardrailState {
  sessionId: string;
  prsHandled: string[];
  unitTestsGreen?: boolean;
  e2eRun?: boolean;
  e2eSkipped?: boolean;
  e2eBlockCount?: number;
  buildIntentRouted?: boolean;
  terminalPending?: number[];
  terminalHandled?: number[];
  terminalBlockCount?: number;
  watchSkipped?: boolean;
  watchBlockCount?: number;
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

/** Outcome of the watcher-arm Stop gate for a turn end. */
export enum WatchGateAction {
  Block = "block",
  Release = "release",
  None = "none",
}

/** A watcher-arm gate decision: the action, the running block count, and the opened-but-untracked PR urls that drove it. */
export interface WatchGateDecision {
  action: WatchGateAction;
  blockCount: number;
  untracked: string[];
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

export interface HookInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: ToolInput;
  // `content` is unknown because an MCP tool's result is structured — usually an
  // array of typed parts, not a string. Readers must narrow rather than assume.
  tool_response?: { stdout?: string; stderr?: string; output?: string; content?: unknown };
  prompt?: string;
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
