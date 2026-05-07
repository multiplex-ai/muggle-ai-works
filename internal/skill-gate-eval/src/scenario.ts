/** Loads scenario files and the fixtures they reference. Types live in `./types`. */

import * as fs from "node:fs";
import * as path from "node:path";

import type { ScenarioFile } from "./types.js";

/**
 * Read and parse a scenarios.json file.
 *
 * Output shape: `ScenarioFile` — { skill, gate, fixturesPath, scenarios[] }.
 * Throws on missing required fields rather than silently returning a
 * malformed object.
 */
export function loadScenarioFile(filePath: string): ScenarioFile {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as ScenarioFile;
  if (!parsed.skill || !parsed.gate || !Array.isArray(parsed.scenarios)) {
    throw new Error(`Invalid scenario file at ${filePath}`);
  }
  return parsed;
}

/**
 * Load a fixtures.json sitting next to (or relative to) the scenario file.
 *
 * Output shape: arbitrary record consumed by `mock-mcp.ts` stubs — keys
 * map to per-tool canned responses (e.g. `projects`, `useCases`,
 * `executeResult`).
 */
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
