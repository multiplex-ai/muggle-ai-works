/** Finds, loads, and validates scenario files. Types live in `./types`. */

import * as fs from "node:fs";
import * as path from "node:path";

import { RESULTS_FILE_SUFFIX, TOOL_PATTERN_EXPECTATION_KEYS } from "./constants.js";
import { applyScenarioDefaults } from "./scenario-defaults.js";
import { isToolAttemptPattern, resolvePatternReferences } from "./tool-patterns.js";
import { isSequencedFixture } from "./tools/sequenced-mock-mcp.js";
import {
  EvalTargetKind,
  ScenarioCadence,
  ScriptedTool,
  type AgentScenario,
  type AgentScenarioExpectation,
  type AgentScenarioFile,
  type ScenarioSuite,
  type ScriptedReply,
  type SeedTranscript,
  type ToolAttemptPattern,
} from "./types.js";

function isScriptedReply(entry: ScriptedReply): boolean {
  const hasSequence =
    Array.isArray(entry.sequence) &&
    entry.sequence.length > 0 &&
    entry.sequence.every((reply) => typeof reply === "string");
  return typeof entry.response === "string" || hasSequence;
}

function validateTranscript(transcript: SeedTranscript, label: string): void {
  if (typeof transcript.resumePrompt !== "string" || !transcript.resumePrompt || !Array.isArray(transcript.turns)) {
    throw new Error(`${label}: seed.transcript needs turns and a non-empty resumePrompt`);
  }
  transcript.turns.forEach((turn, turnIndex) => {
    const turnLabel = `${label}: seed.transcript.turns[${turnIndex}]`;
    if (turn.text !== undefined && typeof turn.text !== "string") throw new Error(`${turnLabel}.text must be a string`);
    if (turn.toolCalls !== undefined && !Array.isArray(turn.toolCalls)) throw new Error(`${turnLabel}.toolCalls must be a list`);
    if (!turn.text && (turn.toolCalls ?? []).length === 0) throw new Error(`${turnLabel} needs text or a tool call`);
    (turn.toolCalls ?? []).forEach((toolCall, callIndex) => {
      const hasInput = typeof toolCall.input === "object" && toolCall.input !== null && !Array.isArray(toolCall.input);
      const isResultValid = toolCall.result === undefined || typeof toolCall.result === "string";
      if (typeof toolCall.tool !== "string" || !hasInput || !isResultValid) {
        throw new Error(`${turnLabel}.toolCalls[${callIndex}] needs tool and an input object; a result, when given, is a string`);
      }
    });
  });
}

function resolveExpectationPatterns(
  expectation: AgentScenarioExpectation,
  namedPatterns: Record<string, ToolAttemptPattern>,
  label: string,
): AgentScenarioExpectation {
  const resolved = { ...expectation };
  for (const key of TOOL_PATTERN_EXPECTATION_KEYS) {
    const entries = expectation[key] as unknown;
    if (entries === undefined) continue;
    if (!Array.isArray(entries)) throw new Error(`${label}: expect.${key} must be a list`);
    resolved[key] = resolvePatternReferences(entries, namedPatterns, `${label} expect.${key}`);
  }
  const sequences = expectation.requireToolSequences as unknown;
  if (sequences !== undefined) {
    if (!Array.isArray(sequences) || !sequences.every(Array.isArray)) {
      throw new Error(`${label}: expect.requireToolSequences must be a list of lists`);
    }
    resolved.requireToolSequences = sequences.map((sequence: unknown[], index) =>
      resolvePatternReferences(sequence, namedPatterns, `${label} expect.requireToolSequences[${index}]`),
    );
  }
  const lastAmong = expectation.requireLastAmong as unknown;
  if (lastAmong !== undefined) {
    if (!Array.isArray(lastAmong)) throw new Error(`${label}: expect.requireLastAmong must be a list`);
    resolved.requireLastAmong = lastAmong.map((entry: unknown, index) => {
      const entryLabel = `${label} expect.requireLastAmong[${index}]`;
      if (typeof entry !== "object" || entry === null || !("among" in entry) || !("last" in entry)) {
        throw new Error(`${entryLabel} needs among and last`);
      }
      const [among, last] = resolvePatternReferences([entry.among, entry.last], namedPatterns, entryLabel);
      return { among: among, last: last };
    });
  }
  return resolved;
}

function validateScenario(scenario: AgentScenario, filePath: string): void {
  const label = `Scenario "${scenario.name}" in ${filePath}`;
  for (const scripted of scenario.bashResponses ?? []) {
    if (typeof scripted.commandContains !== "string" || !isScriptedReply(scripted)) {
      throw new Error(`${label}: each bashResponses entry needs commandContains and a response or non-empty sequence`);
    }
    if (scripted.afterCommandContains !== undefined && typeof scripted.afterCommandContains !== "string") {
      throw new Error(`${label}: bashResponses afterCommandContains must be a string`);
    }
  }
  for (const [tool, entries] of Object.entries(scenario.toolResponses ?? {})) {
    if (!(Object.values(ScriptedTool) as string[]).includes(tool)) {
      throw new Error(`${label}: toolResponses key "${tool}" is not one of ${Object.values(ScriptedTool).join(", ")}`);
    }
    for (const scripted of entries ?? []) {
      if (typeof scripted.argContains !== "string" || !isScriptedReply(scripted)) {
        throw new Error(`${label}: each toolResponses.${tool} entry needs argContains and a response or non-empty sequence`);
      }
    }
  }
  for (const [slot, slotValue] of Object.entries(scenario.fixtures ?? {})) {
    const declaresSequence = typeof slotValue === "object" && slotValue !== null && "sequence" in slotValue;
    if (declaresSequence && !isSequencedFixture(slotValue)) {
      throw new Error(`${label}: fixtures.${slot} must be exactly { "sequence": [<one or more replies>] }`);
    }
  }
  if (scenario.cadence !== undefined && !Object.values(ScenarioCadence).includes(scenario.cadence)) {
    throw new Error(`${label}: cadence must be one of ${Object.values(ScenarioCadence).join(", ")}`);
  }
  if (scenario.maxTurns !== undefined && !(Number.isInteger(scenario.maxTurns) && scenario.maxTurns > 0)) {
    throw new Error(`${label}: maxTurns must be a positive integer`);
  }
  for (const seedFile of scenario.seed?.files ?? []) {
    if (typeof seedFile.path !== "string" || typeof seedFile.content !== "string") {
      throw new Error(`${label}: each seed.files entry needs a path and content`);
    }
  }
  if (scenario.seed?.transcript !== undefined) validateTranscript(scenario.seed.transcript, label);
  for (const artifact of scenario.expect.requireArtifacts ?? []) {
    if (artifact.matches === undefined) continue;
    try {
      new RegExp(artifact.matches);
    } catch (error) {
      throw new Error(`${label}: requireArtifacts ${artifact.path} has an invalid matches regex: ${String(error)}`, {
        cause: error,
      });
    }
  }
}

/**
 * Read and parse a `scenarios/<stem>.json` file, applying its `defaults` to
 * each scenario and replacing each `{ "pattern": "<name>" }` with the named pattern.
 *
 * Output shape: `AgentScenarioFile` — `{ target: { kind, name }, passThreshold?, defaults?, patterns?, scenarios[] }`.
 * Throws on a missing or malformed target, a stem that does not name the target,
 * an empty scenario list, a malformed or unknown pattern, or a scenario without
 * a name/prompt/expect once defaults apply, rather than silently returning a
 * malformed object.
 */
export function loadAgentScenarioFile(filePath: string): AgentScenarioFile {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as AgentScenarioFile;
  if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new Error(`Invalid scenario file at ${filePath}: needs a non-empty scenarios list`);
  }
  const target = parsed.target;
  if (!target || !Object.values(EvalTargetKind).includes(target.kind) || !target.name) {
    throw new Error(
      `Invalid scenario file at ${filePath}: needs target { kind: ${Object.values(EvalTargetKind).join(" | ")}, name }`,
    );
  }
  const stem = path.basename(filePath, ".json");
  if (stem !== target.name && !stem.startsWith(`${target.name}.`)) {
    throw new Error(`Scenario file ${filePath} must be named ${target.name}.json or ${target.name}.<suite>.json`);
  }
  const threshold = parsed.passThreshold;
  if (threshold !== undefined && !(typeof threshold === "number" && threshold > 0 && threshold <= 1)) {
    throw new Error(`Invalid scenario file at ${filePath}: passThreshold must be in (0, 1]`);
  }
  const namedPatterns = parsed.patterns ?? {};
  for (const [name, pattern] of Object.entries(namedPatterns)) {
    if (!isToolAttemptPattern(pattern)) {
      throw new Error(`Invalid scenario file at ${filePath}: patterns.${name} must be { tool, argContains } or { anyOf: [...] }`);
    }
  }
  const seenNames = new Set<string>();
  const scenarios = parsed.scenarios.map((authored) => {
    const scenario = applyScenarioDefaults(authored, parsed.defaults);
    if (!scenario.name || !scenario.prompt || !scenario.expect) {
      throw new Error(
        `Scenario "${scenario.name ?? "<unnamed>"}" in ${filePath} needs name, prompt, and expect`,
      );
    }
    if (seenNames.has(scenario.name)) {
      throw new Error(`Scenario name "${scenario.name}" repeats in ${filePath}`);
    }
    seenNames.add(scenario.name);
    const label = `Scenario "${scenario.name}" in ${filePath}`;
    const resolved = { ...scenario, expect: resolveExpectationPatterns(scenario.expect, namedPatterns, label) };
    validateScenario(resolved, filePath);
    return resolved;
  });
  return { ...parsed, scenarios: scenarios };
}

/** Every scenario file's stem in `scenariosDir`, sorted; results files beside them are skipped. */
export function listScenarioStems(scenariosDir: string): string[] {
  return fs
    .readdirSync(scenariosDir)
    .filter((fileName) => fileName.endsWith(".json") && !fileName.endsWith(RESULTS_FILE_SUFFIX))
    .map((fileName) => path.basename(fileName, ".json"))
    .sort();
}

/**
 * Load the suite `--suite` names, or every suite in the directory when it names none.
 *
 * @throws when the named suite has no file.
 */
export function loadScenarioSuites(scenariosDir: string, suiteStem?: string): ScenarioSuite[] {
  const stems = suiteStem ? [suiteStem] : listScenarioStems(scenariosDir);
  return stems.map((stem) => {
    const filePath = path.resolve(scenariosDir, `${stem}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`No scenario file at ${filePath}`);
    }
    return { stem: stem, filePath: filePath, file: loadAgentScenarioFile(filePath) };
  });
}

/** The scenarios a run at `cadence` covers: a PR run drops nightly-only scenarios; unset or nightly keeps all. */
export function scenariosForCadence(
  scenarios: AgentScenario[],
  cadence: ScenarioCadence | undefined,
): AgentScenario[] {
  if (cadence !== ScenarioCadence.Pr) return scenarios;
  return scenarios.filter((scenario) => (scenario.cadence ?? ScenarioCadence.Pr) === ScenarioCadence.Pr);
}
