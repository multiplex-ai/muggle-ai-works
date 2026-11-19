/** Lets a test load the scenario suites muggle-ai-brain ships, and skips it by name when no brain checkout is present. */

import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it } from "vitest";

import { BRAIN_DIR_ENV_VAR } from "../../../skill-gate-eval/src/constants.js";
import { brainScenariosDir } from "../../src/brain-scenarios.js";

/** The scenarios directory of the brain checkout this test run resolves, as an absolute path. */
export function shippedScenariosDir(): string {
  return path.resolve(brainScenariosDir());
}

/**
 * Declare a suite that loads the shipped scenarios. With no scenarios directory
 * to read, the suite is reported as skipped under a title that says why.
 */
export function describeWithShippedScenarios(title: string, defineSuite: () => void): void {
  const scenariosDir = shippedScenariosDir();
  if (fs.existsSync(scenariosDir)) {
    describe(title, defineSuite);
    return;
  }
  // defineSuite loads scenario files while it is collected, so it cannot run even to be skipped.
  describe.skip(`${title} (skipped: no scenario data at ${scenariosDir}; set ${BRAIN_DIR_ENV_VAR} to a muggle-ai-brain checkout)`, () => {
    it("needs the scenario suites from muggle-ai-brain", () => undefined);
  });
}
