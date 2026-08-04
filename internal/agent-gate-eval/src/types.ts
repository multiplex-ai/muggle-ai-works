/**
 * Shared types for the agent-gate eval — the behavioral contract check for
 * plugin agents (`plugin/agents/*.md`). Mirrors internal/skill-gate-eval but
 * gates on the agent's final report text and tool-attempt trace instead of
 * preference-gate side effects.
 */

import type { Fixtures } from "../../skill-gate-eval/src/types.js";

/** A canned response for an intercepted Bash command. First match wins; `commandContains: ""` is the catch-all. */
export interface ScriptedBashResponse {
  commandContains: string;
  response: string;
}

/** A tool-attempt pattern: `argContains` is matched against the JSON-serialized tool input. */
export interface ToolAttemptPattern {
  tool: string;
  argContains: string;
}

export interface AgentScenarioExpectation {
  /** Substrings that must appear in the agent's final report. */
  outputContains?: string[];
  /** Regex sources (no flags) that must match the final report. */
  outputMatches?: string[];
  /** Substrings that must NOT appear in the final report. */
  outputNotContains?: string[];
  /** Regex sources that must NOT match the final report. */
  outputNotMatches?: string[];
  /** Tool attempts the agent must have made (e.g. ran `muggle build-pr-section`). */
  requireToolAttempts?: ToolAttemptPattern[];
  /** Tool attempts the agent must NOT have made (e.g. `gh pr comment` in a render-only mode). */
  forbidToolAttempts?: ToolAttemptPattern[];
  /**
   * The no-user-channel contract: agents never ask the user. Defaults to true;
   * a scenario can only relax it explicitly (none currently do).
   */
  forbidAskUserQuestion?: boolean;
}

export interface AgentScenario {
  name: string;
  /** The dispatch prompt — the fully-resolved plan/inputs the dispatching skill would send. */
  prompt: string;
  /** Scripted results for intercepted Bash calls. */
  bashResponses?: ScriptedBashResponse[];
  /**
   * Canned muggle MCP responses. When present, the harness mounts the mock
   * muggle server (shared with skill-gate-eval) so an agent whose contract runs
   * through the MCP tools — acceptance-tester — can complete a run hermetically.
   * Absent for the Bash/CLI-driven agents.
   */
  fixtures?: Fixtures;
  expect: AgentScenarioExpectation;
}

export interface AgentScenarioFile {
  /** Must equal the agent's frontmatter `name` and the file basename. */
  agent: string;
  scenarios: AgentScenario[];
}

/** Parsed `plugin/agents/<name>.md`. */
export interface AgentDefinition {
  name: string;
  /** Frontmatter `model:` alias (haiku/sonnet/opus/…) — unresolved. */
  modelAlias: string;
  /** Resolved concrete model id the eval runs on. */
  model: string;
  /** Markdown body with the frontmatter block stripped. */
  body: string;
  /** Absolute path of the definition file (used to resolve its relative links). */
  filePath: string;
}

/** One tool attempt captured by the harness — name plus raw input. */
export interface ToolAttempt {
  tool: string;
  args: Record<string, unknown>;
}

export interface AgentRunVerdict {
  scenario: string;
  pass: boolean;
  reasons: string[];
  trace: {
    finalOutput: string;
    toolAttempts: ToolAttempt[];
    askQuestionCount: number;
  };
}

export interface AgentRunOptions {
  definition: AgentDefinition;
  scenario: AgentScenario;
  maxTurns?: number;
}
