import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    passWithNoTests: true,
    exclude: ['packages/**', 'apps/**', 'node_modules/**', '.worktrees/**'],
  },
});
