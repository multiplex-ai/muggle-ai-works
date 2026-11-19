/** Locates the muggle-ai-brain checkout that holds every eval's scenario data. */

import { BRAIN_DIR_ENV_VAR, DEFAULT_BRAIN_DIR } from "./constants.js";

/**
 * The brain checkout an eval reads: the directory `--brain-dir` named, else
 * BRAIN_DIR_ENV_VAR, else DEFAULT_BRAIN_DIR. A relative result resolves
 * against the working directory.
 */
export function resolveBrainDir(explicitBrainDir?: string): string {
  return explicitBrainDir ?? process.env[BRAIN_DIR_ENV_VAR] ?? DEFAULT_BRAIN_DIR;
}
