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
import {
  DEFAULT_PREFERENCES,
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
  it("has exactly 3 values", () => {
    expect(Object.values(PreferenceValue)).toHaveLength(3);
  });

  it("contains always, ask, never", () => {
    expect(PreferenceValue.Always).toBe("always");
    expect(PreferenceValue.Ask).toBe("ask");
    expect(PreferenceValue.Never).toBe("never");
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
        JSON.stringify({ version: 1, preferences: { defaultExecutionMode: "always" } }),
      );
      const prefs = readProjectPreferences(projectDir);
      expect(prefs.defaultExecutionMode).toBe("always");
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
      writePreferences({ defaultExecutionMode: "always" }, "project", globalDir, projectDir);
      const overridePath = path.join(projectDir, ".muggle-ai", "preferences.json");
      const raw = JSON.parse(fs.readFileSync(overridePath, "utf-8"));
      expect(raw.preferences.defaultExecutionMode).toBe("always");
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
    it("accepts valid key and value", () => {
      expect(validatePreference("autoLogin", "always")).toBe(true);
      expect(validatePreference("verboseOutput", "never")).toBe(true);
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
