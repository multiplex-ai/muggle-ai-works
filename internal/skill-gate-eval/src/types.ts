/**
 * Shared types for the skill-gate eval. Kept here so harness.ts,
 * run.ts, and scenario.ts don't each redeclare the contract.
 */

import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";

/** Canonical preference values a gate can resolve to. */
export enum PreferenceValue {
  Always = "always",
  Never = "never",
  Ask = "ask",
  Local = "local",
  Remote = "remote",
}

/** Canned per-tool responses keyed by the slot the mock-mcp stubs read. */
export interface Fixtures {
  authStatus?: unknown;
  lastProject?: unknown;
  lastHost?: unknown;
  projects?: unknown;
  useCases?: unknown;
  testCases?: unknown;
  testCase?: unknown;
  executeResult?: unknown;
  runResult?: unknown;
  [key: string]: unknown;
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

export interface RunOptions {
  scenarioFile: ScenarioFile;
  scenarioFilePath: string;
  scenario: Scenario;
  skillsDir: string;
  model: string;
  /** Hard cap on agent turns. Exceeding raises a verdict failure rather than running unbounded. */
  maxTurns?: number;
}

export interface CliArgs {
  gate: string;
  skill: string;
  runs: number;
  brainDir: string;
  skillsDir: string;
  model: string;
}

export interface ScenarioReport {
  name: string;
  runs: number;
  passes: number;
  passRate: number;
  passed: boolean;
  failureReasons: string[];
}
