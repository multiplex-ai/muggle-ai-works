import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_PREFERENCES, PreferenceKey } from "../../../packages/mcps/src/index.js";

const toBash = (p: string) => p.replace(/\\/g, "/");

const scriptPath = toBash(
  fileURLToPath(new URL("../../../plugin/scripts/ensure-electron-app.sh", import.meta.url)),
);

let hasBash = false;
try {
  execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
  hasBash = true;
} catch {
  // bash unavailable — the suite below skips
}

/**
 * Run the whole hook against a throwaway home directory.
 *
 * Both caches are pre-warmed so the run never shells out to `muggle setup` or
 * `npm view`: this exercises the context-injection body, nothing else.
 */
function runHook(preferencesFile: Record<string, unknown> | undefined): string {
  const home = mkdtempSync(join(tmpdir(), "muggle-hook-"));

  mkdirSync(join(home, ".cache", "muggle"), { recursive: true });
  writeFileSync(join(home, ".cache", "muggle", "electron-app-checked"), "");
  writeFileSync(join(home, ".cache", "muggle", "version-check"), "1.0.0|1.0.0");

  if (preferencesFile) {
    mkdirSync(join(home, ".muggle-ai"), { recursive: true });
    writeFileSync(
      join(home, ".muggle-ai", "preferences.json"),
      JSON.stringify(preferencesFile, null, 2),
      "utf-8",
    );
  }

  const stdout = execFileSync("bash", [scriptPath], {
    env: {
      ...process.env,
      HOME: toBash(home),
      USERPROFILE: home,
      CLAUDE_PLUGIN_ROOT: "",
      CURSOR_PLUGIN_ROOT: "",
    },
    encoding: "utf-8",
  });

  return (JSON.parse(stdout) as { additional_context: string }).additional_context;
}

const DIRECTIVE_MARKER = "first-run setup has not been run";

describe.skipIf(!hasBash)("ensure-electron-app.sh onboarding trigger", () => {
  it("asks for the walkthrough when no preferences file exists", () => {
    expect(runHook(undefined)).toContain(DIRECTIVE_MARKER);
  });

  it("still asks when setup seeded defaults but nobody was ever prompted", () => {
    const context = runHook({ version: 1, preferences: DEFAULT_PREFERENCES });

    expect(context).toContain(DIRECTIVE_MARKER);
  });

  it("stops asking once the walkthrough is stamped complete", () => {
    const context = runHook({
      version: 1,
      preferences: DEFAULT_PREFERENCES,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(context).not.toContain(DIRECTIVE_MARKER);
    expect(context).toContain("Muggle Test Preferences");
  });
});

describe.skipIf(!hasBash)("ensure-electron-app.sh preference resolution", () => {
  it("resolves unset keys from the shipped defaults, not a stale inline copy", () => {
    const context = runHook({
      version: 1,
      preferences: {},
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });

    for (const [key, value] of Object.entries(DEFAULT_PREFERENCES)) {
      expect(context).toContain(`${key}=${value}`);
    }
  });

  it("lets a saved value win over the default", () => {
    const context = runHook({
      version: 1,
      preferences: { [PreferenceKey.AutoE2ETest]: "ask" },
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(context).toContain("autoE2ETest=ask");
  });
});
