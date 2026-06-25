import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
