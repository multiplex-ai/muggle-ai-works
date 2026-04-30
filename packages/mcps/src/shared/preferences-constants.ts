/**
 * Constants for the user preferences system.
 */

import {
  PreferenceKey,
  PreferenceValue,
  type IPreferences,
  type IPreferenceSchemaEntry,
} from "./preferences-types.js";

/** Preferences file name (used in both global and per-project paths). */
export const PREFERENCES_FILE_NAME = "preferences.json";

/** Per-project preferences subdirectory name. */
export const PREFERENCES_PROJECT_DIR_NAME = ".muggle-ai";

/** Current schema version. */
export const PREFERENCES_VERSION = 1;

/** Default preferences — every knob set to "ask". */
export const DEFAULT_PREFERENCES: IPreferences = {
  [PreferenceKey.AutoLogin]: PreferenceValue.Ask,
  [PreferenceKey.AutoSelectProject]: PreferenceValue.Ask,
  [PreferenceKey.ShowElectronBrowser]: PreferenceValue.Ask,
  [PreferenceKey.OpenTestResultsAfterRun]: PreferenceValue.Ask,
  [PreferenceKey.DefaultExecutionMode]: PreferenceValue.Ask,
  [PreferenceKey.AutoPublishLocalResults]: PreferenceValue.Ask,
  [PreferenceKey.SuggestRelatedUseCases]: PreferenceValue.Ask,
  [PreferenceKey.SuggestRelatedTestCases]: PreferenceValue.Ask,
  [PreferenceKey.AutoDetectChanges]: PreferenceValue.Ask,
  [PreferenceKey.PostPRVisualWalkthrough]: PreferenceValue.Ask,
  [PreferenceKey.CheckForUpdates]: PreferenceValue.Ask,
  [PreferenceKey.VerboseOutput]: PreferenceValue.Ask,
};

const ALWAYS_ASK_NEVER = [
  PreferenceValue.Always,
  PreferenceValue.Ask,
  PreferenceValue.Never,
] as const;

const LOCAL_REMOTE_ASK = [
  PreferenceValue.Local,
  PreferenceValue.Remote,
  PreferenceValue.Ask,
] as const;

/**
 * Per-key allowed values. Most preferences accept `always`/`ask`/`never`.
 * `defaultExecutionMode` is the exception: it accepts `local`/`remote`/`ask`
 * because "always" / "never" don't meaningfully describe a binary mode choice.
 */
export const PREFERENCE_ALLOWED_VALUES: Record<PreferenceKey, readonly PreferenceValue[]> = {
  [PreferenceKey.AutoLogin]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoSelectProject]: ALWAYS_ASK_NEVER,
  [PreferenceKey.ShowElectronBrowser]: ALWAYS_ASK_NEVER,
  [PreferenceKey.OpenTestResultsAfterRun]: ALWAYS_ASK_NEVER,
  [PreferenceKey.DefaultExecutionMode]: LOCAL_REMOTE_ASK,
  [PreferenceKey.AutoPublishLocalResults]: ALWAYS_ASK_NEVER,
  [PreferenceKey.SuggestRelatedUseCases]: ALWAYS_ASK_NEVER,
  [PreferenceKey.SuggestRelatedTestCases]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoDetectChanges]: ALWAYS_ASK_NEVER,
  [PreferenceKey.PostPRVisualWalkthrough]: ALWAYS_ASK_NEVER,
  [PreferenceKey.CheckForUpdates]: ALWAYS_ASK_NEVER,
  [PreferenceKey.VerboseOutput]: ALWAYS_ASK_NEVER,
};

/** Human-readable schema for each preference — used in setup wizard and validation. */
export const PREFERENCES_SCHEMA: Record<PreferenceKey, IPreferenceSchemaEntry> = {
  [PreferenceKey.AutoLogin]: {
    description: "When a tool requires auth and saved credentials exist, reuse them without prompting",
  },
  [PreferenceKey.AutoSelectProject]: {
    description: "When a skill needs a Muggle project and one was used previously in this repo, reuse it without prompting",
  },
  [PreferenceKey.ShowElectronBrowser]: {
    description: "When running local E2E tests, show the Electron browser window",
  },
  [PreferenceKey.OpenTestResultsAfterRun]: {
    description: "After a local E2E test run completes, open the per-run results page on Muggle dashboard",
  },
  [PreferenceKey.DefaultExecutionMode]: {
    description: "When a skill supports both local and remote test execution, which to default to",
  },
  [PreferenceKey.AutoPublishLocalResults]: {
    description: "After a local E2E test run completes, upload results to Muggle cloud for team visibility",
  },
  [PreferenceKey.SuggestRelatedUseCases]: {
    description: "After creating or running a use case, suggest related use cases to add",
  },
  [PreferenceKey.SuggestRelatedTestCases]: {
    description: "After creating or running a test case, suggest related test cases to add",
  },
  [PreferenceKey.AutoDetectChanges]: {
    description: "When running muggle-test, scan local git changes and map to affected test cases",
  },
  [PreferenceKey.PostPRVisualWalkthrough]: {
    description: "After test results are available, post visual walkthrough comment with screenshots to the PR",
  },
  [PreferenceKey.CheckForUpdates]: {
    description: "At session start, check if a newer Muggle version is available and notify",
  },
  [PreferenceKey.VerboseOutput]: {
    description: "Show detailed progress logs during skill and tool execution",
  },
};
