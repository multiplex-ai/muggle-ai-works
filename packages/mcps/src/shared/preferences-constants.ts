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

/**
 * Default preferences — max automation out of the box. Every knob defaults
 * to its proceed-without-asking value. Two deliberate exceptions:
 * `showElectronBrowser` stays visible so a new user sees their first run, and
 * `verboseOutput` stays quiet (it's UX noise, not automation).
 * `defaultExecutionMode` resolves to `local` rather than re-prompting.
 */
export const DEFAULT_PREFERENCES: IPreferences = {
  [PreferenceKey.AutoLogin]: PreferenceValue.Always,
  [PreferenceKey.AutoSelectProject]: PreferenceValue.Always,
  [PreferenceKey.AutoSelectLocalHost]: PreferenceValue.Always,
  [PreferenceKey.ShowElectronBrowser]: PreferenceValue.Always,
  [PreferenceKey.OpenTestResultsAfterRun]: PreferenceValue.Always,
  [PreferenceKey.DefaultExecutionMode]: PreferenceValue.Local,
  [PreferenceKey.SuggestRelatedUseCases]: PreferenceValue.Always,
  [PreferenceKey.SuggestRelatedTestCases]: PreferenceValue.Always,
  [PreferenceKey.AutoDetectChanges]: PreferenceValue.Always,
  [PreferenceKey.PostPRVisualWalkthrough]: PreferenceValue.Always,
  [PreferenceKey.AutoCreatePR]: PreferenceValue.Always,
  [PreferenceKey.CheckForUpdates]: PreferenceValue.Always,
  [PreferenceKey.VerboseOutput]: PreferenceValue.Never,
  [PreferenceKey.AutoUseWorktree]: PreferenceValue.Always,
  [PreferenceKey.AutoRebase]: PreferenceValue.Always,
  [PreferenceKey.AutoCleanup]: PreferenceValue.Always,
  [PreferenceKey.AutoE2ETest]: PreferenceValue.Always,
  [PreferenceKey.AutoResolveConflicts]: PreferenceValue.Always,
  [PreferenceKey.AutoReuseValidationContext]: PreferenceValue.Always,
  [PreferenceKey.AutoRouteBuildToMuggleDo]: PreferenceValue.Always,
  [PreferenceKey.AutoWatchPR]: PreferenceValue.Always,
  [PreferenceKey.ReusePreparePlan]: PreferenceValue.Always,
};

const ALWAYS_ASK_NEVER = [
  PreferenceValue.Always,
  PreferenceValue.Ask,
  PreferenceValue.Never,
] as const;

const ALWAYS_ASK = [
  PreferenceValue.Always,
  PreferenceValue.Ask,
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
  [PreferenceKey.AutoSelectLocalHost]: ALWAYS_ASK_NEVER,
  [PreferenceKey.ShowElectronBrowser]: ALWAYS_ASK_NEVER,
  [PreferenceKey.OpenTestResultsAfterRun]: ALWAYS_ASK_NEVER,
  [PreferenceKey.DefaultExecutionMode]: LOCAL_REMOTE_ASK,
  [PreferenceKey.SuggestRelatedUseCases]: ALWAYS_ASK_NEVER,
  [PreferenceKey.SuggestRelatedTestCases]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoDetectChanges]: ALWAYS_ASK_NEVER,
  [PreferenceKey.PostPRVisualWalkthrough]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoCreatePR]: ALWAYS_ASK_NEVER,
  [PreferenceKey.CheckForUpdates]: ALWAYS_ASK_NEVER,
  [PreferenceKey.VerboseOutput]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoUseWorktree]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoRebase]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoCleanup]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoE2ETest]: ALWAYS_ASK,
  [PreferenceKey.AutoResolveConflicts]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoReuseValidationContext]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoRouteBuildToMuggleDo]: ALWAYS_ASK_NEVER,
  [PreferenceKey.AutoWatchPR]: ALWAYS_ASK_NEVER,
  [PreferenceKey.ReusePreparePlan]: ALWAYS_ASK_NEVER,
};

/** Human-readable schema for each preference — used in setup wizard and validation. */
export const PREFERENCES_SCHEMA: Record<PreferenceKey, IPreferenceSchemaEntry> = {
  [PreferenceKey.AutoLogin]: {
    description: "When a tool requires auth and saved credentials exist, reuse them without prompting",
  },
  [PreferenceKey.AutoSelectProject]: {
    description: "When a skill needs a Muggle Test project and one was used previously in this repo, reuse it without prompting",
  },
  [PreferenceKey.AutoSelectLocalHost]: {
    description: "When running local tests, reuse the dev server URL from the previous run in this repo without prompting",
  },
  [PreferenceKey.ShowElectronBrowser]: {
    description: "When running local E2E tests, show the Electron browser window",
  },
  [PreferenceKey.OpenTestResultsAfterRun]: {
    description: "After a local E2E test run completes, open the per-run results page on Muggle Test dashboard",
  },
  [PreferenceKey.DefaultExecutionMode]: {
    description: "When a skill supports both local and remote test execution, which to default to",
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
  [PreferenceKey.AutoCreatePR]: {
    description: "At the end of the muggle-do dev cycle (or when a test needs an open PR to post results to), push the branch and open a PR without prompting",
  },
  [PreferenceKey.CheckForUpdates]: {
    description: "At session start, check if a newer Muggle Test version is available and notify",
  },
  [PreferenceKey.VerboseOutput]: {
    description: "Show detailed progress logs during skill and tool execution",
  },
  [PreferenceKey.AutoUseWorktree]: {
    description: "When starting non-trivial development work, create a git worktree to isolate the change from the current checkout",
  },
  [PreferenceKey.AutoRebase]: {
    description: "Before running dev servers or E2E tests on a branch behind origin, rebase onto the default branch first",
  },
  [PreferenceKey.AutoCleanup]: {
    description: "After a PR is merged, automatically run the cleanup sequence: remove worktree, delete branches, clear local artifacts, prune [gone] branches",
  },
  [PreferenceKey.AutoE2ETest]: {
    description: "Run Stage 6 (E2E acceptance) at the end of every /muggle-do cycle (default always — running E2E is the point of muggle-do; never is not an option)",
  },
  [PreferenceKey.AutoResolveConflicts]: {
    description: "When a rebase onto the default branch hits conflicts, resolve them autonomously behind a verify-or-rollback gate instead of aborting and escalating",
  },
  [PreferenceKey.AutoReuseValidationContext]: {
    description: "When a prior session left an E2E validation context for this working tree, reuse it instead of re-asking the validation questions",
  },
  [PreferenceKey.AutoRouteBuildToMuggleDo]: {
    description: "When a prompt looks like a build/implement/fix request, route it through the /muggle-do pipeline (requirements → build → impact → tests → E2E → PR → watcher)",
  },
  [PreferenceKey.AutoWatchPR]: {
    description: "After a test run opens a PR, start a muggle-pr-followup watcher that polls for new reviews and hands them to /muggle-do",
  },
  [PreferenceKey.ReusePreparePlan]: {
    description: "Reuse the saved prepare plan for this stack (skip discovery, jump to check-running + smoke-test) instead of rediscovering from scratch",
  },
};
