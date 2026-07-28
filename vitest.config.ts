import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Watch never exits and orphans on Windows kill; opt-in only.
    watch: process.env.MUGGLE_VITEST_WATCH === "1",
    passWithNoTests: true,
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
        // Daemon I/O shell (fs scans, gh subprocess, detached spawns); its
        // decision logic lives in the covered sibling modules.
        "src/watchdog/cli.ts",
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
