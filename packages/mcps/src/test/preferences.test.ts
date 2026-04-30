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
import { PreferencesSetInputSchema } from "../mcp/local/contracts/preferences-schemas.js";
import {
  DEFAULT_PREFERENCES,
  PREFERENCE_ALLOWED_VALUES,
  PREFERENCES_FILE_NAME,
  PREFERENCES_SCHEMA,
  PREFERENCES_VERSION,
} from "../shared/preferences-constants.js";

import {
  readGlobalPreferences,
  readProjectPreferences,
  resolvePreferences,
  writePreferences,
  resetPreference,
  isFirstRun,
  validatePreference,
  formatPreferencesOneLiner,
} from "../shared/preferences.js";

describe("PreferenceKey enum", () => {
  it("has exactly 12 keys", () => {
    const keys = Object.values(PreferenceKey);
    expect(keys).toHaveLength(12);
  });

  it("contains all expected keys", () => {
    expect(PreferenceKey.AutoLogin).toBe("autoLogin");
    expect(PreferenceKey.AutoSelectProject).toBe("autoSelectProject");
    expect(PreferenceKey.ShowElectronBrowser).toBe("showElectronBrowser");
    expect(PreferenceKey.OpenTestResultsAfterRun).toBe("openTestResultsAfterRun");
    expect(PreferenceKey.DefaultExecutionMode).toBe("defaultExecutionMode");
    expect(PreferenceKey.AutoPublishLocalResults).toBe("autoPublishLocalResults");
    expect(PreferenceKey.SuggestRelatedUseCases).toBe("suggestRelatedUseCases");
    expect(PreferenceKey.SuggestRelatedTestCases).toBe("suggestRelatedTestCases");
    expect(PreferenceKey.AutoDetectChanges).toBe("autoDetectChanges");
    expect(PreferenceKey.PostPRVisualWalkthrough).toBe("postPRVisualWalkthrough");
    expect(PreferenceKey.CheckForUpdates).toBe("checkForUpdates");
    expect(PreferenceKey.VerboseOutput).toBe("verboseOutput");
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

  it("defaults every key to ask", () => {
    for (const value of Object.values(DEFAULT_PREFERENCES)) {
      expect(value).toBe(PreferenceValue.Ask);
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

  describe("readGlobalPreferences", () => {
    it("returns defaults when file does not exist", () => {
      const prefs = readGlobalPreferences(globalDir);
      expect(prefs).toEqual(DEFAULT_PREFERENCES);
    });

    it("reads saved preferences", () => {
      const filePath = path.join(globalDir, "preferences.json");
      fs.writeFileSync(filePath, JSON.stringify({
        version: 1,
        preferences: { autoLogin: "always" },
      }));
      const prefs = readGlobalPreferences(globalDir);
      expect(prefs.autoLogin).toBe("always");
      expect(prefs.autoSelectProject).toBe("ask");
    });
  });

  describe("readProjectPreferences", () => {
    it("returns empty object when no project file exists", () => {
      const prefs = readProjectPreferences(projectDir);
      expect(prefs).toEqual({});
    });

    it("reads project overrides", () => {
      const overrideDir = path.join(projectDir, ".muggle-ai");
      fs.mkdirSync(overrideDir, { recursive: true });
      fs.writeFileSync(
        path.join(overrideDir, "preferences.json"),
        JSON.stringify({ version: 1, preferences: { defaultExecutionMode: "local" } }),
      );
      const prefs = readProjectPreferences(projectDir);
      expect(prefs.defaultExecutionMode).toBe("local");
    });
  });

  describe("resolvePreferences", () => {
    it("merges global + project, project wins", () => {
      fs.writeFileSync(
        path.join(globalDir, "preferences.json"),
        JSON.stringify({ version: 1, preferences: { autoLogin: "always", verboseOutput: "never" } }),
      );
      const overrideDir = path.join(projectDir, ".muggle-ai");
      fs.mkdirSync(overrideDir, { recursive: true });
      fs.writeFileSync(
        path.join(overrideDir, "preferences.json"),
        JSON.stringify({ version: 1, preferences: { autoLogin: "never" } }),
      );

      const resolved = resolvePreferences(globalDir, projectDir);
      expect(resolved.autoLogin).toBe("never");
      expect(resolved.verboseOutput).toBe("never");
      expect(resolved.checkForUpdates).toBe("ask");
    });
  });

  describe("writePreferences", () => {
    it("writes global preferences file", () => {
      writePreferences({ autoLogin: "always" }, "global", globalDir, projectDir);
      const raw = JSON.parse(fs.readFileSync(path.join(globalDir, "preferences.json"), "utf-8"));
      expect(raw.version).toBe(1);
      expect(raw.preferences.autoLogin).toBe("always");
    });

    it("writes project preferences file", () => {
      writePreferences({ defaultExecutionMode: "local" }, "project", globalDir, projectDir);
      const overridePath = path.join(projectDir, ".muggle-ai", "preferences.json");
      const raw = JSON.parse(fs.readFileSync(overridePath, "utf-8"));
      expect(raw.preferences.defaultExecutionMode).toBe("local");
    });
  });

  describe("resetPreference", () => {
    it("removes a single key from global file", () => {
      fs.writeFileSync(
        path.join(globalDir, "preferences.json"),
        JSON.stringify({ version: 1, preferences: { autoLogin: "always", verboseOutput: "never" } }),
      );
      resetPreference("autoLogin", "global", globalDir, projectDir);
      const raw = JSON.parse(fs.readFileSync(path.join(globalDir, "preferences.json"), "utf-8"));
      expect(raw.preferences.autoLogin).toBeUndefined();
      expect(raw.preferences.verboseOutput).toBe("never");
    });

    it("resets entire file when no key provided", () => {
      fs.writeFileSync(
        path.join(globalDir, "preferences.json"),
        JSON.stringify({ version: 1, preferences: { autoLogin: "always" } }),
      );
      resetPreference(undefined, "global", globalDir, projectDir);
      const raw = JSON.parse(fs.readFileSync(path.join(globalDir, "preferences.json"), "utf-8"));
      expect(raw.preferences).toEqual({});
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
      expect(result).toContain("autoLogin=ask");
      expect(result).toContain("verboseOutput=ask");
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
    expect(result.scope).toBe("global");
  });

  it("accepts project scope", () => {
    const result = PreferencesSetInputSchema.parse({
      key: "autoLogin",
      value: "never",
      scope: "project",
      cwd: "/some/path",
    });
    expect(result.scope).toBe("project");
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
