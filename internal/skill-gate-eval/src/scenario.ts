/**
 * Scenario file shape. Scenarios live in muggle-ai-brain/eval/, this
 * file just describes what the harness consumes.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type PreferenceValue =
  | "always"
  | "never"
  | "ask"
  | "local"
  | "remote";

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

export function loadScenarioFile(filePath: string): ScenarioFile {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as ScenarioFile;
  if (!parsed.skill || !parsed.gate || !Array.isArray(parsed.scenarios)) {
    throw new Error(`Invalid scenario file at ${filePath}`);
  }
  return parsed;
}

export function loadFixtures(
  scenarioFile: string,
  fixturesPath: string,
): Record<string, unknown> {
  const resolved = path.resolve(path.dirname(scenarioFile), fixturesPath);
  return JSON.parse(fs.readFileSync(resolved, "utf8")) as Record<
    string,
    unknown
  >;
}
