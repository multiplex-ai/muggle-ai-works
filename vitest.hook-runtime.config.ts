import { defineConfig } from "vitest/config";
import {
  TEST_RUN_ENV,
  SPAWN_HEAVY_TIMEOUT_MS,
  WALL_CLOCK_HOOK_TESTS,
  RUN_TEMP_ROOT_GLOBAL_SETUP,
  RUN_TEMP_ROOT_SETUP_FILE,
} from "./vitest.config";

/** Runs the wall-clock-bound hook suites alone, one file and one test at a time, so they measure the hooks rather than the suite. */
export default defineConfig({
  test: {
    watch: false,
    include: WALL_CLOCK_HOOK_TESTS,
    fileParallelism: false,
    testTimeout: SPAWN_HEAVY_TIMEOUT_MS,
    hookTimeout: SPAWN_HEAVY_TIMEOUT_MS,
    env: TEST_RUN_ENV,
    globalSetup: [RUN_TEMP_ROOT_GLOBAL_SETUP],
    setupFiles: [RUN_TEMP_ROOT_SETUP_FILE],
  },
});
