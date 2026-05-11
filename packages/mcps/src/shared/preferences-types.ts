/**
 * Type definitions for the user preferences system.
 */

/**
 * Preference keys — one per behavioral knob.
 */
export enum PreferenceKey {
  /** Reuse saved credentials when a tool requires auth. */
  AutoLogin = "autoLogin",
  /** Reuse the last-used Muggle Test project for this repo. */
  AutoSelectProject = "autoSelectProject",
  /** Reuse the last-used local dev server URL for this repo. */
  AutoSelectLocalHost = "autoSelectLocalHost",
  /** Show the Electron browser window during local E2E tests. */
  ShowElectronBrowser = "showElectronBrowser",
  /** Open the per-run results page on Muggle Test dashboard after local test completion. */
  OpenTestResultsAfterRun = "openTestResultsAfterRun",
  /** Default to local or remote test execution. */
  DefaultExecutionMode = "defaultExecutionMode",
  /** Upload local test results to Muggle Test cloud for team visibility. */
  AutoPublishLocalResults = "autoPublishLocalResults",
  /** Suggest related use cases after creating or running one. */
  SuggestRelatedUseCases = "suggestRelatedUseCases",
  /** Suggest related test cases after creating or running one. */
  SuggestRelatedTestCases = "suggestRelatedTestCases",
  /** Scan local git changes and map to affected test cases. */
  AutoDetectChanges = "autoDetectChanges",
  /** Post visual walkthrough comment with screenshots to the PR. */
  PostPRVisualWalkthrough = "postPRVisualWalkthrough",
  /** Check for newer Muggle Test versions at session start. */
  CheckForUpdates = "checkForUpdates",
  /** Show detailed progress logs during execution. */
  VerboseOutput = "verboseOutput",
  /** Create a git worktree before starting non-trivial development work. */
  AutoUseWorktree = "autoUseWorktree",
  /** Rebase onto the default branch before running dev servers or E2E tests. */
  AutoRebase = "autoRebase",
  /** After a PR is merged, run the cleanup sequence (worktree, branches, artifacts) automatically. */
  AutoCleanup = "autoCleanup",
}

/**
 * Allowed values for preference knobs.
 *
 * Most knobs use `Always` / `Ask` / `Never`. A few use domain-specific values:
 *  - `DefaultExecutionMode` uses `Local` / `Remote` / `Ask`.
 *
 * Per-key validity is enforced via `PREFERENCE_ALLOWED_VALUES` in preferences-constants.ts.
 */
export enum PreferenceValue {
  /** Proceed without asking. */
  Always = "always",
  /** Ask the user each time. */
  Ask = "ask",
  /** Skip without asking. */
  Never = "never",
  /** For DefaultExecutionMode: always run tests on the local Electron browser. */
  Local = "local",
  /** For DefaultExecutionMode: always run tests in the Muggle Test cloud. */
  Remote = "remote",
}

/**
 * Map of all preference keys to their values.
 */
export type IPreferences = Record<PreferenceKey, PreferenceValue>;

/**
 * Partial preferences — used for per-project overrides.
 */
export type IPartialPreferences = Partial<IPreferences>;

/**
 * On-disk preferences file shape.
 */
export interface IPreferencesFile {
  /** Schema version for future migrations. */
  version: number;
  /** The preference key-value pairs. */
  preferences: IPartialPreferences;
}

/**
 * Schema entry describing a single preference knob.
 */
export interface IPreferenceSchemaEntry {
  /** Human-readable description of what this knob gates. */
  description: string;
}
