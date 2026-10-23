/** Finds, loads, and validates scenario files. Types live in `./types`. */

import * as fs from "node:fs";
import * as path from "node:path";

import { RESULTS_FILE_SUFFIX } from "./constants.js";
import { isSequencedFixture } from "./tools/sequenced-mock-mcp.js";
import {
  EvalTargetKind,
  ScenarioCadence,
  ScriptedTool,
  type AgentScenario,
  type AgentScenarioFile,
  type ScenarioSuite,
  type ScriptedReply,
} from "./types.js";

function isScriptedReply(entry: ScriptedReply): boolean {
  const hasSequence =
    Array.isArray(entry.sequence) &&
    entry.sequence.length > 0 &&
    entry.sequence.every((reply) => typeof reply === "string");
  return typeof entry.response === "string" || hasSequence;
}

function validateScenario(scenario: AgentScenario, filePath: string): void {
  const label = `Scenario "${scenario.name}" in ${filePath}`;
  for (const scripted of scenario.bashResponses ?? []) {
    if (typeof scripted.commandContains !== "string" || !isScriptedReply(scripted)) {
      throw new Error(`${label}: each bashResponses entry needs commandContains and a response or non-empty sequence`);
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
 * Read and parse a `scenarios/<stem>.json` file.
 *
 * Output shape: `AgentScenarioFile` — `{ target: { kind, name }, passThreshold?, scenarios[] }`.
 * Throws on a missing or malformed target, a stem that does not name the target,
 * an empty scenario list, or a scenario without a name/prompt/expect, rather than
 * silently returning a malformed object.
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
  const seenNames = new Set<string>();
  for (const scenario of parsed.scenarios) {
    if (!scenario.name || !scenario.prompt || !scenario.expect) {
      throw new Error(
        `Scenario "${scenario.name ?? "<unnamed>"}" in ${filePath} needs name, prompt, and expect`,
      );
    }
    if (seenNames.has(scenario.name)) {
      throw new Error(`Scenario name "${scenario.name}" repeats in ${filePath}`);
    }
    seenNames.add(scenario.name);
    validateScenario(scenario, filePath);
  }
  return parsed;
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
