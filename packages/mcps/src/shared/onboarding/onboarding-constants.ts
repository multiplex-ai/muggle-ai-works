/**
 * Constants for the first-run onboarding walkthrough.
 */

import { PreferenceKey, PreferenceValue } from "../preferences-types.js";
import {
  OnboardingBlanketChoice,
  type IOnboardingBlanketOption,
  type IOnboardingChoiceLayout,
  type IOnboardingGroupLayout,
} from "./onboarding-types.js";

/** Opening sentence of the primer. */
export const ONBOARDING_PRIMER_HEADLINE = "Muggle Test drives a real browser against your app.";

/** Supporting points shown under the primer headline. */
export const ONBOARDING_PRIMER_BULLETS: readonly string[] = [
  "Tests are plain English",
  "Scripts replay as regressions",
  "Run locally or in the cloud",
  "Real logins, real inboxes",
  "Screenshots land on your PR",
];

/**
 * How many times the walkthrough may be declined before it retires itself.
 * Past this the offer is never shown again.
 */
export const ONBOARDING_MAX_OFFERS = 3;

/**
 * Value written for a toggle entry the user leaves off, where the key has a gate to
 * prompt at. `ask` rather than `never`, because declining to automate something means
 * "check with me", not "disable this feature permanently".
 */
export const ONBOARDING_UNSELECTED_TOGGLE_VALUE = PreferenceValue.Ask;

/** Question text shown above every toggle group's entries. */
export const ONBOARDING_TOGGLE_PROMPT =
  'Which of these should Muggle do on its own? Anything you leave off is set to "ask".';

/**
 * Multi-key groups whose members are each toggled on (`always`) or left off.
 * Extends the grouping the `/mprefs` configure picker uses, which reaches 19 of the
 * 23 keys, so first-run setup covers every knob without inventing new headings.
 */
export const ONBOARDING_TOGGLE_GROUPS: readonly IOnboardingGroupLayout[] = [
  {
    header: "Auth & session",
    keys: [
      PreferenceKey.AutoLogin,
      PreferenceKey.AutoSelectProject,
      PreferenceKey.CheckForUpdates,
      PreferenceKey.VerboseOutput,
    ],
  },
  {
    header: "Test setup",
    keys: [
      PreferenceKey.AutoSelectLocalHost,
      PreferenceKey.AutoDetectChanges,
      PreferenceKey.AutoReuseValidationContext,
      PreferenceKey.ReusePreparePlan,
    ],
  },
  {
    header: "Test run",
    keys: [PreferenceKey.ShowElectronBrowser, PreferenceKey.OpenTestResultsAfterRun],
  },
  {
    header: "Suggestions",
    keys: [PreferenceKey.SuggestRelatedUseCases, PreferenceKey.SuggestRelatedTestCases],
  },
  {
    header: "PR",
    keys: [
      PreferenceKey.PostPRVisualWalkthrough,
      PreferenceKey.AutoCreatePR,
      PreferenceKey.AutoWatchPR,
      PreferenceKey.AutoRouteBuildToMuggleDo,
    ],
  },
  {
    header: "Branch hygiene",
    keys: [
      PreferenceKey.AutoUseWorktree,
      PreferenceKey.AutoRebase,
      PreferenceKey.AutoCleanup,
      PreferenceKey.AutoResolveConflicts,
    ],
  },
];

/**
 * Single-key groups whose values are domain-specific rather than
 * always/ask/never, so they cannot be expressed as a toggle.
 */
export const ONBOARDING_CHOICE_GROUPS: readonly IOnboardingChoiceLayout[] = [
  {
    header: "E2E acceptance",
    key: PreferenceKey.AutoE2ETest,
    prompt: "Run E2E acceptance at the end of every dev cycle?",
    optionLabels: [
      { value: PreferenceValue.Always, label: "Always run it at the end" },
      { value: PreferenceValue.Ask, label: "Ask each cycle" },
    ],
  },
  {
    header: "Default mode",
    key: PreferenceKey.DefaultExecutionMode,
    prompt: "Where should tests run by default?",
    optionLabels: [
      { value: PreferenceValue.Local, label: "Local — run on my computer" },
      { value: PreferenceValue.Remote, label: "Remote — run in the Muggle Test cloud" },
      { value: PreferenceValue.Ask, label: "Ask each time" },
    ],
  },
  {
    header: "PR watcher",
    key: PreferenceKey.WatcherLifetime,
    prompt: "How long should a PR watcher keep polling for new reviews?",
    optionLabels: [
      { value: PreferenceValue.OneDay, label: "Retire after 1 day" },
      { value: PreferenceValue.SevenDays, label: "Retire after 7 days" },
      { value: PreferenceValue.Never, label: "Never retire — no time-based reaper for an orphaned loop" },
    ],
  },
  {
    header: "Rebase budget",
    key: PreferenceKey.MaxCatchUpRebases,
    prompt: "How many times should a PR be rebased onto a moving base before you are asked to step in?",
    optionLabels: [
      { value: PreferenceValue.TenRebases, label: "Stop after 10" },
      { value: PreferenceValue.TwentyRebases, label: "Stop after 20" },
      { value: PreferenceValue.FiftyRebases, label: "Stop after 50" },
      { value: PreferenceValue.Never, label: "Never stop — an active base can rebase a PR for as long as it stays open" },
    ],
  },
];

/** Dispositions offered before the per-group questions. */
export const ONBOARDING_BLANKET_OPTIONS: readonly IOnboardingBlanketOption[] = [
  {
    choice: OnboardingBlanketChoice.AcceptDefaults,
    label: "Accept recommended defaults",
    description: "Automate the safe parts, run tests locally, show the browser. Done in one keystroke.",
  },
  {
    choice: OnboardingBlanketChoice.AskEverything,
    label: "Ask me before everything",
    description: "Nothing proceeds unattended. Features stay available; Muggle just checks with you first.",
  },
  {
    choice: OnboardingBlanketChoice.Customize,
    label: "Walk me through the questions",
    description: "Go group by group, with the recommended answer pre-selected.",
  },
  {
    choice: OnboardingBlanketChoice.Skip,
    label: "Skip for now",
    description: "Use defaults without saving a choice. Offered again next session.",
  },
];
