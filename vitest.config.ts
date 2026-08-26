import { defineConfig } from "vitest/config";

/** Ceiling for a single test or hook. Sized for the suites that spawn a TypeScript-compiling subprocess per assertion, not for the median test. */
const SPAWN_HEAVY_TIMEOUT_MS = 30_000;

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
    // First entry is Vitest's default glob (kept so packages/** and internal/**
    // stay discovered); second makes the top-level test/ tree — tests mirror
    // their src/ path there — explicit.
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "test/**/*.test.ts"],
    exclude: ['apps/**', '**/node_modules/**', '**/.claude/worktrees/**'],
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
