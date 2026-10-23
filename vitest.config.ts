import { defineConfig } from "vitest/config";

/** Ceiling for a single test or hook. Sized for the suites that spawn a TypeScript-compiling subprocess per assertion, not for the median test. */
export const SPAWN_HEAVY_TIMEOUT_MS = 30_000;

/**
 * Hook suites the wall clock decides, so they run alone under vitest.hook-runtime.config.ts: the runtime budget times
 * the hooks, and the NO_APP_LOGIC_CHANGE suite's verdict hangs on a git call finishing inside the hook's 600ms
 * child-process deadline. Beside ~150 other suites spawning at once, both measure process-start contention instead.
 */
export const WALL_CLOCK_HOOK_TESTS = [
  "src/test/guardrails/footprint/hook-runtime-budget.test.ts",
  "src/test/guardrails/no-app-logic-change-hook.test.ts",
];

/** Env every vitest run here sets; why is noted where the config below applies it. */
export const GUARDRAIL_TEST_ENV = { MUGGLE_GUARDRAIL_GH_CALLS: "off" };

export default defineConfig({
  test: {
    // Watch never exits and orphans on Windows kill; opt-in only.
    watch: process.env.MUGGLE_VITEST_WATCH === "1",
    passWithNoTests: true,
    // Vitest defaults to 5s. Several suites here spawn `node --import tsx` per
    // assertion — hook-execution.test.ts alone does it 78 times, recompiling
    // TypeScript each call — and local-execution-lock.test.ts takes a real
    // 500ms lock. Under parallel load on Windows that tips over: three
    // different files have failed at 5058ms, 5262ms and 5718ms while passing
    // in isolation, including on unmodified master. Generous enough to absorb
    // spawn contention, short enough to still catch a genuine hang.
    testTimeout: SPAWN_HEAVY_TIMEOUT_MS,
    hookTimeout: SPAWN_HEAVY_TIMEOUT_MS,
    // Guardrail hooks call `gh` for real, and the hook-execution fixtures carry
    // live PR urls. Inherited by the subprocesses those tests spawn, so no test
    // run — here or on a contributor's authenticated machine — can reach a PR.
    env: GUARDRAIL_TEST_ENV,
    // First entry is Vitest's default glob (kept so packages/** and internal/**
    // stay discovered); second makes the top-level test/ tree — tests mirror
    // their src/ path there — explicit.
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "test/**/*.test.ts"],
    exclude: ['apps/**', '**/node_modules/**', '**/.claude/worktrees/**', ...WALL_CLOCK_HOOK_TESTS],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**",
        // Pure re-export barrels and thin process bootstraps with no branchable logic.
        "src/index.ts",
        "src/cli/index.ts",
        "src/cli/main.ts",
        "src/server/index.ts",
        // Launcher I/O shell (backend probes, spawn, signal traps); its
        // decision logic lives in the covered sibling modules.
        "src/guard-run/cli.ts",
      ],
      reporter: ["text", "json-summary"],
      thresholds: {
        lines: 92,
        statements: 92,
        functions: 90,
        branches: 78,
      },
    },
  },
});
