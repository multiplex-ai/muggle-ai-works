import { defineConfig } from "vitest/config";
import { GUARDRAIL_TEST_ENV, HOOK_RUNTIME_BUDGET_TESTS, SPAWN_HEAVY_TIMEOUT_MS } from "./vitest.config";

/** Times the hooks alone, one file and one test at a time, so the budget measures the hooks rather than the suite. */
export default defineConfig({
  test: {
    watch: false,
    include: [HOOK_RUNTIME_BUDGET_TESTS],
    fileParallelism: false,
    testTimeout: SPAWN_HEAVY_TIMEOUT_MS,
    hookTimeout: SPAWN_HEAVY_TIMEOUT_MS,
    env: GUARDRAIL_TEST_ENV,
  },
});
