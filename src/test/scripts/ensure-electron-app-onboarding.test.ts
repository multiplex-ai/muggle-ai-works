import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Import the leaf modules, not the package barrel — the rule preference-gates-lint.test.ts documents.
import { DEFAULT_PREFERENCES } from "../../../packages/mcps/src/shared/preferences-constants.js";
import { PreferenceKey } from "../../../packages/mcps/src/shared/preferences-types.js";
import { ONBOARDING_MAX_OFFERS } from "../../../packages/mcps/src/shared/onboarding/onboarding-constants.js";

// Each case shells out to the real hook, which spawns bash plus a node child per run.
// That is seconds, not milliseconds, and slows further on a loaded machine or a shared
// CI runner — the default 30s timeout turns ordinary contention into a red run.
vi.setConfig({ testTimeout: 180_000 });

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
 * A throwaway home with both caches pre-warmed, so a hook run never shells out to
 * `muggle setup` or `npm view` and exercises only the context-injection body.
 */
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "muggle-hook-"));
  mkdirSync(join(home, ".cache", "muggle"), { recursive: true });
  writeFileSync(join(home, ".cache", "muggle", "electron-app-checked"), "");
  writeFileSync(join(home, ".cache", "muggle", "version-check"), "1.0.0|1.0.0");
  return home;
}

function writePreferences(home: string, contents: Record<string, unknown>): void {
  mkdirSync(join(home, ".muggle-ai"), { recursive: true });
  writeFileSync(
    join(home, ".muggle-ai", "preferences.json"),
    JSON.stringify(contents, null, 2),
    "utf-8",
  );
}

function runHookIn(home: string): string {
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

function runHook(preferencesFile: Record<string, unknown> | undefined): string {
  const home = makeHome();
  if (preferencesFile) {
    writePreferences(home, preferencesFile);
  }
  return runHookIn(home);
}

const DIRECTIVE_MARKER = "first-run setup has not been run";
const STAMPED = { version: 1, preferences: DEFAULT_PREFERENCES, onboardingCompletedAt: "2026-01-01T00:00:00.000Z" };

describe.skipIf(!hasBash)("ensure-electron-app.sh onboarding trigger", () => {
  it("asks for the walkthrough when no preferences file exists", () => {
    expect(runHook(undefined)).toContain(DIRECTIVE_MARKER);
  });

  it("still asks when setup seeded defaults but nobody was ever prompted", () => {
    expect(runHook({ version: 1, preferences: DEFAULT_PREFERENCES })).toContain(DIRECTIVE_MARKER);
  });

  it("stops asking once the walkthrough is stamped complete", () => {
    const context = runHook(STAMPED);

    expect(context).not.toContain(DIRECTIVE_MARKER);
    expect(context).toContain("Muggle Test Preferences");
  });

  it("reports preferences even with no file, since defaults are what the code will use", () => {
    const context = runHook(undefined);

    expect(context).toContain("Muggle Test Preferences");
    expect(context).toContain(`autoE2ETest=${DEFAULT_PREFERENCES[PreferenceKey.AutoE2ETest]}`);
  });
});

describe.skipIf(!hasBash)("ensure-electron-app.sh offer cap", () => {
  it("stops offering after the cap, and still reports preferences once retired", () => {
    const home = makeHome();

    // One sequence answers both questions; splitting them would double the hook
    // spawns to prove the same thing.
    const contexts: string[] = [];
    for (let session = 0; session < ONBOARDING_MAX_OFFERS + 2; session += 1) {
      contexts.push(runHookIn(home));
    }
    const offered = contexts.map((context) => context.includes(DIRECTIVE_MARKER));

    expect(offered.slice(0, ONBOARDING_MAX_OFFERS)).toEqual(
      Array(ONBOARDING_MAX_OFFERS).fill(true),
    );
    expect(offered.slice(ONBOARDING_MAX_OFFERS)).toEqual([false, false]);
    expect(contexts[contexts.length - 1]).toContain("Muggle Test Preferences");
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
