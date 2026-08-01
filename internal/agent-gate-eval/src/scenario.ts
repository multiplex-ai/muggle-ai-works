/** Loads agent scenario files. Types live in `./types`. */

import * as fs from "node:fs";

import type { AgentScenarioFile } from "./types.js";

/**
 * Read and parse a `scenarios/<agent>.json` file.
 *
 * Output shape: `AgentScenarioFile` — `{ agent, scenarios[] }`. Throws on a
 * missing `agent` field, an empty scenario list, or a scenario without a
 * name/prompt/expect, rather than silently returning a malformed object.
 */
export function loadAgentScenarioFile(filePath: string): AgentScenarioFile {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as AgentScenarioFile;
  if (!parsed.agent || !Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
    throw new Error(`Invalid agent scenario file at ${filePath}`);
  }
  for (const scenario of parsed.scenarios) {
    if (!scenario.name || !scenario.prompt || !scenario.expect) {
      throw new Error(
        `Scenario "${scenario.name ?? "<unnamed>"}" in ${filePath} needs name, prompt, and expect`,
      );
    }
  }
  return parsed;
}
