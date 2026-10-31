import { tmpdir } from "os";
import type { TestProject } from "vitest/node";
import { RUN_TEMP_ROOT_CONTEXT_KEY } from "./constants.js";
import { createRunTempRoot, removeRunTempRoot, sweepStaleRunTempRoots } from "./runTempRoot.js";

/**
 * Gives the run one temp root that every worker and spawned process writes under, and removes it when the run ends.
 * @returns the teardown vitest calls after the last test, pass or fail
 */
export default function setupRunTempRoot(project: TestProject): () => void {
  const realTempDir = tmpdir();
  sweepStaleRunTempRoots(realTempDir, Date.now());
  const runTempRoot = createRunTempRoot(realTempDir);
  project.provide(RUN_TEMP_ROOT_CONTEXT_KEY, runTempRoot);
  return () => {
    removeRunTempRoot(runTempRoot);
  };
}
