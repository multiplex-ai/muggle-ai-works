/**
 * Shared types for the skill-gate eval. Kept here so harness.ts,
 * run.ts, and scenario.ts don't each redeclare the contract.
 */

import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import type { ZodRawShape } from "zod";

/** Canonical preference values a gate can resolve to. */
export enum PreferenceValue {
  Always = "always",
  Never = "never",
  Ask = "ask",
  Local = "local",
  Remote = "remote",
}

/** Canned per-tool responses keyed by the slot the mock-tools stubs read. */
export interface Fixtures {
  authStatus?: unknown;
  /** Canned `muggle-remote-auth-register` reply, for a flow that opens its own account. */
  authRegister?: unknown;
  /** Canned `muggle-remote-auth-api-key-create` reply. */
  apiKeyCreate?: unknown;
  lastProject?: unknown;
  lastHost?: unknown;
  projects?: unknown;
  useCases?: unknown;
  testCases?: unknown;
  testCase?: unknown;
  executeResult?: unknown;
  runResult?: unknown;
  runStepsResult?: unknown;
  [key: string]: unknown;
}

/** One canned muggle tool, as either host mounts it. */
export interface MockToolSpec {
  name: string;
  description: string;
  /** Input fields the host advertises; a field a gate inspects must be declared here. */
  shape: ZodRawShape;
  /** The canned reply, before it is wrapped as MCP content. */
  reply: () => unknown;
}

/** Returned from `buildMockMcpServer`; the harness mounts `config` and calls are recorded by the harness via canUseTool. */
export interface MockServerHandle {
  config: McpSdkServerConfigWithInstance;
}

/** One tool call captured by the harness — the agent's raw input, not the post-zod-parsed handler args. */
export interface MockCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface ScenarioExpectation {
  /**
   * Whether the agent should call AskQuestion specifically for the gate
   * being tested. `false` for `always`/`never` (silent path); `true`
   * for absent / `ask`. Other AskQuestion calls (project picker, etc.)
   * are unrelated and do not violate this expectation.
   */
  askQuestionForGate: boolean;

  /**
   * Substring that must appear in the AskQuestion text when the gate
   * fires (only checked when askQuestionForGate=true). Lets the
   * scenario assert "the question that was asked is the gate's
   * canonical Picker 1 question, not some other AskQuestion call."
   */
  gateQuestionSubstring?: string;

  /**
   * Which Muggle execute tool the agent must end up calling, and the
   * arg shape that proves the gate's effect was applied. Use the
   * literal string "OMITTED" as a value to assert the key was not
   * present in the call (e.g., showUi must be omitted for `always`).
   */
  executeTool?:
    | "muggle-local-execute-test-generation"
    | "muggle-local-execute-replay";
  executeArgs?: Record<string, unknown | "OMITTED">;
}

export interface Scenario {
  name: string;
  preferences: Record<string, PreferenceValue>;
  /**
   * Extra session-context lines beyond the preferences line — e.g. the
   * `Muggle Test Last Project: ...` cache. Each entry becomes a line
   * under the SessionStart context.
   */
  sessionContext?: string[];
  userPrompt: string;
  /**
   * Canned answers for AskQuestion calls the harness must auto-respond
   * to in order to keep the agent flowing (e.g., project picker). Map
   * by a substring of the question; first match wins.
   */
  askQuestionAnswers?: Array<{ questionContains: string; answer: string }>;
  expect: ScenarioExpectation;
}

export interface ScenarioFile {
  skill: string;
  gate: string;
  fixturesPath: string; // relative to scenario file
  scenarios: Scenario[];
}

/** One AskQuestion call captured by the harness during a run. */
export interface AskQuestionRecord {
  question: string;
  answer: string | null;
}

export interface RunVerdict {
  scenario: string;
  pass: boolean;
  reasons: string[];
  trace: {
    mcpCalls: MockCall[];
    askQuestions: AskQuestionRecord[];
  };
}

/** The files and scenario context a gate prompt is built from — see prompt-inputs.ts. */
export interface GatePromptInputs {
  skillBody: string;
  /** The gate-under-test's contract, or "" when the skill has none on disk. */
  gateBody: string;
  /** The scenario's preferences as `key=value` pairs, space-separated. */
  prefs: string;
  /** The scenario's other session-context lines, newline-joined. */
  extraContext: string;
}

export interface RunOptions {
  scenarioFile: ScenarioFile;
  scenarioFilePath: string;
  scenario: Scenario;
  skillsDir: string;
  model: string;
  /** Hard cap on agent turns. Exceeding raises a verdict failure rather than running unbounded. */
  maxTurns?: number;
}

/** The agent host a gate runs in. */
export enum EvalHost {
  Claude = "claude",
  Codex = "codex",
}

/** One scenario run under Codex (codex-harness.ts). */
export interface CodexRunOptions extends Omit<RunOptions, "model" | "maxTurns"> {
  /** The Codex home prepareCodexGateHome set up for this scenario file. */
  codexHome: string;
  /** Unset, Codex runs its default model — the session's model, which is what a skill gets in Codex. */
  model?: string;
  /** Extra `-c key=value` overrides for every `codex exec`, e.g. a model provider. */
  configOverrides?: string[];
}

/** One tool call the Codex hook recorded, with the scripted pick it answered a question with. */
export interface CodexGateTraceEntry {
  tool_name: string;
  tool_input: Record<string, unknown>;
  /** Present on a `request_user_input` call: the pick it was answered with, or null when none was scripted. */
  answer?: string | null;
}

/** How one `codex exec` turn exited, and what it printed. */
export interface CodexTurnOutput {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface CliArgs {
  gate: string;
  skill: string;
  runs: number;
  brainDir: string;
  skillsDir: string;
  /** The host the reps run in. */
  host: EvalHost;
  /** Under Codex, "" runs Codex's default model, since Codex ignores a skill's `model:`. */
  model: string;
  /** Under Codex: a Codex home the eval may own; unset, each run gets a fresh one. */
  codexHome?: string;
  /** Under Codex: `key=value` config overrides passed to every run. */
  codexConfig: string[];
  /** Max eval reps in flight at once; 1 reproduces the old sequential behavior. */
  concurrency: number;
}

/** Shared cooldown: one throttled rep pauses new starts for every worker. */
export interface ThrottleGateLike {
  reportThrottle(backoffMs: number): void;
  waitUntilClear(): Promise<void>;
}

export interface ThrottleRetryOptions {
  gate: ThrottleGateLike;
  maxRetries?: number;
  computeBackoffMs?: (attempt: number) => number;
  onThrottle?: (attempt: number, backoffMs: number, error: unknown) => void;
}

export interface ScenarioReport {
  name: string;
  runs: number;
  passes: number;
  passRate: number;
  passed: boolean;
  failureReasons: string[];
}
