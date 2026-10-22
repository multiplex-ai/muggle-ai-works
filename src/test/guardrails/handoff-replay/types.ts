/** One step of muggle-do's forward run, replayed as the hook events it produces. */
export enum HandoffStep {
  BuildRequest = "build-request",
  SkillInvocation = "skill-invocation",
  StageReads = "stage-reads",
  UnitTests = "unit-tests",
  E2eExecution = "e2e-execution",
  E2eSkipDeclaration = "e2e-skip-declaration",
  PrCreation = "pr-creation",
  WalkthroughPost = "walkthrough-post",
  WatcherHandoff = "watcher-handoff",
}

/** A Stop gate a handoff step exists to satisfy, spelled as its CLI subcommand. */
export enum HandoffStopGate {
  E2e = "e2e-gate",
  Walkthrough = "walkthrough-gate",
  Watch = "watch-gate",
}

/** Which hook-firing moment of a session a replayed interaction is. */
export enum ReplayedInteractionKind {
  Prompt = "prompt",
  ToolCall = "tool-call",
}

/** The user's prompt, which fires UserPromptSubmit. */
export interface ReplayedPrompt {
  kind: ReplayedInteractionKind.Prompt;
  prompt: string;
}

/** A tool call, which fires PreToolUse, runs the tool, then fires PostToolUse with the tool's response. */
export interface ReplayedToolCall {
  kind: ReplayedInteractionKind.ToolCall;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResponse: unknown;
  /** What running the tool leaves on disk, applied between the two events. */
  applySideEffect?: () => void;
}

/** One hook-firing moment of a replayed session. */
export type ReplayedInteraction = ReplayedPrompt | ReplayedToolCall;

/** One synthetic session: the HOME its state lives in, the repo it works in, and the environment every hook runs under. */
export interface HandoffSession {
  home: string;
  sessionId: string;
  repoDirectory: string;
  environment: NodeJS.ProcessEnv;
}

/** One hook command's answer during a replay, labelled with the interaction that fired it. */
export interface ReplayedHookAnswer {
  eventLabel: string;
  status: number | null;
  stdout: string;
}

/** A replay case: the steps the session takes, and the one Stop gate expected to block — none when every gate stays silent. */
export interface HandoffReplayCase {
  label: string;
  steps: HandoffStep[];
  blockingGate?: HandoffStopGate;
}
