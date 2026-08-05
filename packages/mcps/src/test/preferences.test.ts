/**
 * Tests for the preferences type system and constants.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  PreferenceKey,
  PreferenceValue,
} from "../shared/preferences-types.js";
import { ProjectPreferencesReconcileOutcome } from "../shared/project-preferences-reconcile-types.js";
import { PreferencesSetInputSchema } from "../mcp/local/contracts/preferences-schemas.js";
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_ALLOWED_VALUES,
  PREFERENCES_FILE_NAME,
  PREFERENCES_SCHEMA,
  PREFERENCES_VERSION,
} from "../shared/preferences-constants.js";

import {
  reconcileProjectPreferences,
  resolvePreferences,
  writePreferences,
  resetPreference,
  isFirstRun,
  validatePreference,
  formatPreferencesOneLiner,
} from "../shared/preferences-service.js";

describe("PreferenceKey enum", () => {
  it("has exactly 22 keys", () => {
    const keys = Object.values(PreferenceKey);
    expect(keys).toHaveLength(22);
  });

  it("contains all expected keys", () => {
    expect(PreferenceKey.AutoLogin).toBe("autoLogin");
    expect(PreferenceKey.AutoSelectProject).toBe("autoSelectProject");
    expect(PreferenceKey.AutoSelectLocalHost).toBe("autoSelectLocalHost");
    expect(PreferenceKey.ShowElectronBrowser).toBe("showElectronBrowser");
    expect(PreferenceKey.OpenTestResultsAfterRun).toBe("openTestResultsAfterRun");
    expect(PreferenceKey.DefaultExecutionMode).toBe("defaultExecutionMode");
    expect(PreferenceKey.SuggestRelatedUseCases).toBe("suggestRelatedUseCases");
    expect(PreferenceKey.SuggestRelatedTestCases).toBe("suggestRelatedTestCases");
    expect(PreferenceKey.AutoDetectChanges).toBe("autoDetectChanges");
    expect(PreferenceKey.PostPRVisualWalkthrough).toBe("postPRVisualWalkthrough");
    expect(PreferenceKey.AutoCreatePR).toBe("autoCreatePR");
    expect(PreferenceKey.CheckForUpdates).toBe("checkForUpdates");
    expect(PreferenceKey.VerboseOutput).toBe("verboseOutput");
    expect(PreferenceKey.AutoUseWorktree).toBe("autoUseWorktree");
    expect(PreferenceKey.AutoRebase).toBe("autoRebase");
    expect(PreferenceKey.AutoCleanup).toBe("autoCleanup");
    expect(PreferenceKey.AutoE2ETest).toBe("autoE2ETest");
    expect(PreferenceKey.AutoResolveConflicts).toBe("autoResolveConflicts");
    expect(PreferenceKey.AutoReuseValidationContext).toBe("autoReuseValidationContext");
    expect(PreferenceKey.AutoRouteBuildToMuggleDo).toBe("autoRouteBuildToMuggleDo");
    expect(PreferenceKey.AutoWatchPR).toBe("autoWatchPR");
    expect(PreferenceKey.ReusePreparePlan).toBe("reusePreparePlan");
  });
});

describe("PreferenceValue enum", () => {
  it("has exactly 5 values (always/ask/never + local/remote)", () => {
    expect(Object.values(PreferenceValue)).toHaveLength(5);
  });

  it("contains always, ask, never, local, remote", () => {
    expect(PreferenceValue.Always).toBe("always");
    expect(PreferenceValue.Ask).toBe("ask");
    expect(PreferenceValue.Never).toBe("never");
    expect(PreferenceValue.Local).toBe("local");
    expect(PreferenceValue.Remote).toBe("remote");
  });
});

describe("PREFERENCE_ALLOWED_VALUES", () => {
  it("has an entry for every PreferenceKey", () => {
    for (const key of Object.values(PreferenceKey)) {
      expect(PREFERENCE_ALLOWED_VALUES[key]).toBeDefined();
      expect(PREFERENCE_ALLOWED_VALUES[key].length).toBeGreaterThan(0);
    }
  });

  it("uses always/ask/never for most keys", () => {
    const usual = [PreferenceValue.Always, PreferenceValue.Ask, PreferenceValue.Never];
    expect(PREFERENCE_ALLOWED_VALUES[PreferenceKey.AutoLogin]).toEqual(usual);
    expect(PREFERENCE_ALLOWED_VALUES[PreferenceKey.VerboseOutput]).toEqual(usual);
    expect(PREFERENCE_ALLOWED_VALUES[PreferenceKey.CheckForUpdates]).toEqual(usual);
  });

  it("uses local/remote/ask for defaultExecutionMode", () => {
    expect(PREFERENCE_ALLOWED_VALUES[PreferenceKey.DefaultExecutionMode]).toEqual([
      PreferenceValue.Local,
      PreferenceValue.Remote,
      PreferenceValue.Ask,
    ]);
  });
});

describe("DEFAULT_PREFERENCES", () => {
  it("has an entry for every PreferenceKey", () => {
    for (const key of Object.values(PreferenceKey)) {
      expect(DEFAULT_PREFERENCES).toHaveProperty(key);
    }
  });

  it("defaults to max automation (always) except defaultExecutionMode (local) and verboseOutput (never)", () => {
    for (const [key, value] of Object.entries(DEFAULT_PREFERENCES)) {
      const expected =
        key === PreferenceKey.DefaultExecutionMode
          ? PreferenceValue.Local
          : key === PreferenceKey.VerboseOutput
            ? PreferenceValue.Never
            : PreferenceValue.Always;
      expect(value, `DEFAULT_PREFERENCES.${key}`).toBe(expected);
    }
  });
});

describe("PREFERENCES_SCHEMA", () => {
  it("has a description for every PreferenceKey", () => {
    for (const key of Object.values(PreferenceKey)) {
      expect(PREFERENCES_SCHEMA[key]).toBeDefined();
      expect(PREFERENCES_SCHEMA[key].description).toBeTruthy();
    }
  });
});

describe("constants", () => {
  it("exports correct file name", () => {
    expect(PREFERENCES_FILE_NAME).toBe("preferences.json");
  });

  it("exports version 1", () => {
    expect(PREFERENCES_VERSION).toBe(1);
  });
});

describe("PreferencesService", () => {
  let tempDir: string;
  let globalDir: string;
  let projectDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-prefs-test-"));
    globalDir = path.join(tempDir, "global", ".muggle-ai");
    projectDir = path.join(tempDir, "project");
    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("isFirstRun", () => {
    it("returns true when no preferences file exists", () => {
      expect(isFirstRun(globalDir)).toBe(true);
    });

    it("returns false when preferences file exists", () => {
      const filePath = path.join(globalDir, "preferences.json");
      fs.writeFileSync(filePath, JSON.stringify({ version: 1, preferences: {} }));
      expect(isFirstRun(globalDir)).toBe(false);
    });
  });

  function writeGlobalPreferences(prefs: Record<string, string>): void {
    fs.writeFileSync(
      path.join(globalDir, "preferences.json"),
      JSON.stringify({ version: 1, preferences: prefs }),
    );
  }

  function writeLegacyProjectPreferences(prefs: Record<string, string>): void {
    const dir = path.join(projectDir, ".muggle-ai");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "preferences.json"),
      JSON.stringify({ version: 1, preferences: prefs }),
    );
  }

  function readGlobalPreferencesFile(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(path.join(globalDir, "preferences.json"), "utf-8"));
  }

  describe("resolvePreferences", () => {
    it("returns defaults when no global file exists", () => {
      expect(resolvePreferences(globalDir)).toEqual(DEFAULT_PREFERENCES);
    });

    it("overlays the global file on defaults", () => {
      writeGlobalPreferences({ autoLogin: "never" });
      const resolved = resolvePreferences(globalDir);
      expect(resolved.autoLogin).toBe("never"); // saved value overrides the default
      expect(resolved.autoSelectProject).toBe("always"); // unsaved key falls back to default
    });

    it("ignores a project preferences file", () => {
      writeGlobalPreferences({ autoLogin: "always" });
      writeLegacyProjectPreferences({ autoLogin: "never" });
      expect(resolvePreferences(globalDir).autoLogin).toBe("always");
    });
  });

  describe("writePreferences", () => {
    it("writes the global preferences file", () => {
      writePreferences({ autoLogin: "always" }, globalDir);
      const file = readGlobalPreferencesFile();
      expect(file.version).toBe(1);
      expect((file.preferences as Record<string, string>).autoLogin).toBe("always");
    });

    it("merges over keys already on disk", () => {
      writeGlobalPreferences({ verboseOutput: "always" });
      writePreferences({ autoLogin: "never" }, globalDir);
      expect(readGlobalPreferencesFile().preferences).toEqual({
        verboseOutput: "always",
        autoLogin: "never",
      });
    });
  });

  describe("resetPreference", () => {
    it("removes a single key from global file", () => {
      writeGlobalPreferences({ autoLogin: "always", verboseOutput: "never" });
      resetPreference("autoLogin", globalDir);
      const saved = readGlobalPreferencesFile().preferences as Record<string, string>;
      expect(saved.autoLogin).toBeUndefined();
      expect(saved.verboseOutput).toBe("never");
    });

    it("resets entire file when no key provided", () => {
      writeGlobalPreferences({ autoLogin: "always" });
      resetPreference(undefined, globalDir);
      expect(readGlobalPreferencesFile().preferences).toEqual({});
    });
  });

  describe("reconcileProjectPreferences", () => {
    it("reports no action when the project has no preferences file", () => {
      writeGlobalPreferences({ autoLogin: "never" });
      const report = reconcileProjectPreferences(projectDir, globalDir);
      expect(report.outcome).toBe(ProjectPreferencesReconcileOutcome.NoAction);
      expect(report.shadowedKeys).toEqual([]);
    });

    it("copies the project file forward when no global file exists", () => {
      writeLegacyProjectPreferences({ autoLogin: "never", verboseOutput: "always" });

      const report = reconcileProjectPreferences(projectDir, globalDir);

      expect(report.outcome).toBe(ProjectPreferencesReconcileOutcome.CopiedToGlobal);
      expect(report.shadowedKeys).toEqual([]);
      expect(readGlobalPreferencesFile().preferences).toEqual({
        autoLogin: "never",
        verboseOutput: "always",
      });
      expect(resolvePreferences(globalDir).autoLogin).toBe("never");
    });

    it("leaves the project file on disk after copying it forward", () => {
      writeLegacyProjectPreferences({ autoLogin: "never" });
      reconcileProjectPreferences(projectDir, globalDir);
      const report = reconcileProjectPreferences(projectDir, globalDir);
      expect(fs.existsSync(report.projectFilePath)).toBe(true);
    });

    it("never merges into an existing global file — it reports the shadowed keys instead", () => {
      writeGlobalPreferences({ autoLogin: "always" });
      writeLegacyProjectPreferences({ autoLogin: "never", showElectronBrowser: "never" });

      const report = reconcileProjectPreferences(projectDir, globalDir);

      expect(report.outcome).toBe(ProjectPreferencesReconcileOutcome.KeysShadowed);
      expect(report.shadowedKeys).toEqual([
        PreferenceKey.AutoLogin,
        PreferenceKey.ShowElectronBrowser,
      ]);
      expect(readGlobalPreferencesFile().preferences).toEqual({ autoLogin: "always" });
      expect(resolvePreferences(globalDir).autoLogin).toBe("always");
    });

    it("omits project keys that already match the resolved global value", () => {
      writeGlobalPreferences({ autoLogin: "never" });
      writeLegacyProjectPreferences({
        autoLogin: "never",
        autoSelectProject: "always", // equals the default, so nothing changes
        verboseOutput: "always",
      });

      const report = reconcileProjectPreferences(projectDir, globalDir);

      expect(report.shadowedKeys).toEqual([PreferenceKey.VerboseOutput]);
    });

    it("reports no action when every project key already matches", () => {
      writeGlobalPreferences({ autoLogin: "never" });
      writeLegacyProjectPreferences({ autoLogin: "never" });
      const report = reconcileProjectPreferences(projectDir, globalDir);
      expect(report.outcome).toBe(ProjectPreferencesReconcileOutcome.NoAction);
      expect(report.shadowedKeys).toEqual([]);
    });
  });

  describe("validatePreference", () => {
    it("accepts valid key and value (always/ask/never keys)", () => {
      expect(validatePreference("autoLogin", "always")).toBe(true);
      expect(validatePreference("verboseOutput", "never")).toBe(true);
      expect(validatePreference("autoLogin", "ask")).toBe(true);
    });

    it("accepts local/remote/ask for defaultExecutionMode", () => {
      expect(validatePreference("defaultExecutionMode", "local")).toBe(true);
      expect(validatePreference("defaultExecutionMode", "remote")).toBe(true);
      expect(validatePreference("defaultExecutionMode", "ask")).toBe(true);
    });

    it("rejects always/never for defaultExecutionMode", () => {
      expect(validatePreference("defaultExecutionMode", "always")).toBe(false);
      expect(validatePreference("defaultExecutionMode", "never")).toBe(false);
    });

    it("rejects local/remote for keys that don't accept them", () => {
      expect(validatePreference("autoLogin", "local")).toBe(false);
      expect(validatePreference("verboseOutput", "remote")).toBe(false);
    });

    it("rejects invalid key", () => {
      expect(validatePreference("notAKey", "always")).toBe(false);
    });

    it("rejects invalid value", () => {
      expect(validatePreference("autoLogin", "sometimes")).toBe(false);
    });
  });

  describe("formatPreferencesOneLiner", () => {
    it("formats all preferences into a compact string", () => {
      const result = formatPreferencesOneLiner(DEFAULT_PREFERENCES);
      expect(result).toContain("autoLogin=always");
      expect(result).toContain("verboseOutput=never");
      expect(result).toContain("defaultExecutionMode=local");
    });
  });
});

describe("PreferencesSetInputSchema", () => {
  it("accepts valid input", () => {
    const result = PreferencesSetInputSchema.parse({
      key: "autoLogin",
      value: "always",
    });
    expect(result.key).toBe("autoLogin");
    expect(result.value).toBe("always");
  });

  it("rejects a scope argument left over from the per-project era", () => {
    // Stripping it would apply a preference the caller scoped to one project
    // across every project instead — the opposite of what was asked.
    expect(() =>
      PreferencesSetInputSchema.parse({
        key: "autoLogin",
        value: "never",
        scope: "project",
        cwd: "/some/path",
      }),
    ).toThrow(/scope and cwd are no longer accepted/);
  });

  it("still reports a field error against the field, not the object", () => {
    // The object-level message must not swallow ordinary validation failures.
    expect(() =>
      PreferencesSetInputSchema.parse({ key: "autoLogin", value: "banana" }),
    ).toThrow(/banana|not allowed|expected/i);
  });

  it("rejects invalid key", () => {
    expect(() =>
      PreferencesSetInputSchema.parse({ key: "badKey", value: "always" }),
    ).toThrow();
  });

  it("rejects invalid value", () => {
    expect(() =>
      PreferencesSetInputSchema.parse({ key: "autoLogin", value: "sometimes" }),
    ).toThrow();
  });

  it("accepts local/remote for defaultExecutionMode", () => {
    expect(
      PreferencesSetInputSchema.parse({ key: "defaultExecutionMode", value: "local" }).value,
    ).toBe("local");
    expect(
      PreferencesSetInputSchema.parse({ key: "defaultExecutionMode", value: "remote" }).value,
    ).toBe("remote");
  });

  it("rejects always for defaultExecutionMode", () => {
    expect(() =>
      PreferencesSetInputSchema.parse({ key: "defaultExecutionMode", value: "always" }),
    ).toThrow();
  });

  it("rejects local for autoLogin", () => {
    expect(() =>
      PreferencesSetInputSchema.parse({ key: "autoLogin", value: "local" }),
    ).toThrow();
  });
});
