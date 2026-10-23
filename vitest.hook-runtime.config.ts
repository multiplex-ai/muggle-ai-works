import { defineConfig } from "vitest/config";
import { GUARDRAIL_TEST_ENV, SPAWN_HEAVY_TIMEOUT_MS, WALL_CLOCK_HOOK_TESTS } from "./vitest.config";

/** Runs the wall-clock-bound hook suites alone, one file and one test at a time, so they measure the hooks rather than the suite. */
export default defineConfig({
  test: {
    watch: false,
    include: WALL_CLOCK_HOOK_TESTS,
    fileParallelism: false,
    testTimeout: SPAWN_HEAVY_TIMEOUT_MS,
    hookTimeout: SPAWN_HEAVY_TIMEOUT_MS,
    env: GUARDRAIL_TEST_ENV,
  },
});
