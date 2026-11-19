/** Locates the scenario suites, which live in a muggle-ai-brain checkout. */

import * as path from "node:path";

import { resolveBrainDir } from "../../skill-gate-eval/src/brain-dir.js";
import { SCENARIOS_BRAIN_SUBPATH } from "./constants.js";

/**
 * The scenarios directory inside the brain checkout `resolveBrainDir` picks.
 *
 * Output shape: `<brain-dir>/eval/agent-gate-eval/scenarios`.
 */
export function brainScenariosDir(explicitBrainDir?: string): string {
  return path.join(resolveBrainDir(explicitBrainDir), ...SCENARIOS_BRAIN_SUBPATH);
}
