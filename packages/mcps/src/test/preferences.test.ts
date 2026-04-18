/**
 * Tests for the preferences type system and constants.
 */

import { describe, expect, it } from "vitest";

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
