/** Applies a scenario file's `defaults` to one of its scenarios (merge rules on `ScenarioDefaults`). */

import type { AgentScenario, ScenarioDefaults, ScriptedTool, ScriptedToolResponses } from "./types.js";

function mergeToolResponses(
  scenarioResponses: ScriptedToolResponses | undefined,
  defaultResponses: ScriptedToolResponses | undefined,
): ScriptedToolResponses | undefined {
  if (!scenarioResponses && !defaultResponses) return undefined;
  const merged: ScriptedToolResponses = {};
  const tools = new Set([...Object.keys(scenarioResponses ?? {}), ...Object.keys(defaultResponses ?? {})]);
  for (const tool of tools as Set<ScriptedTool>) {
    merged[tool] = [...(scenarioResponses?.[tool] ?? []), ...(defaultResponses?.[tool] ?? [])];
  }
  return merged;
}

function mergeRecords<Value>(
  scenarioRecord: Record<string, Value> | undefined,
  defaultRecord: Record<string, Value> | undefined,
): Record<string, Value> | undefined {
  if (!scenarioRecord && !defaultRecord) return undefined;
  return { ...defaultRecord, ...scenarioRecord };
}

/**
 * The scenario with the file's defaults applied: its own `prompt`, `seed` and
 * `maxTurns` win outright, `preferences` and `fixtures` merge key by key, and
 * its `bashResponses` and `toolResponses` entries go first so they win the
 * first match.
 */
export function applyScenarioDefaults(scenario: AgentScenario, defaults: ScenarioDefaults | undefined): AgentScenario {
  if (!defaults) return scenario;
  const merged: AgentScenario = {
    ...scenario,
    prompt: scenario.prompt ?? defaults.prompt,
    seed: scenario.seed ?? defaults.seed,
    maxTurns: scenario.maxTurns ?? defaults.maxTurns,
    preferences: mergeRecords(scenario.preferences, defaults.preferences),
    fixtures: mergeRecords(scenario.fixtures, defaults.fixtures),
    bashResponses:
      scenario.bashResponses || defaults.bashResponses
        ? [...(scenario.bashResponses ?? []), ...(defaults.bashResponses ?? [])]
        : undefined,
    toolResponses: mergeToolResponses(scenario.toolResponses, defaults.toolResponses),
  };
  for (const key of Object.keys(merged) as Array<keyof AgentScenario>) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged;
}
