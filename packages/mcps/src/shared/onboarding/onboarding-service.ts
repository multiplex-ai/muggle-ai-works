/**
 * Onboarding service — decide whether the first-run walkthrough is owed,
 * build the questions, and record the outcome.
 *
 * Completion is tracked separately from the preferences file existing. `muggle setup`
 * seeds defaults silently on the first session, so file presence cannot distinguish
 * "the user chose these" from "nobody was ever asked".
 */

import {
  DEFAULT_PREFERENCES,
  PREFERENCE_ALLOWED_VALUES,
  PREFERENCES_SCHEMA,
} from "../preferences-constants.js";
import {
  readPreferencesMetadata,
  writePreferencesWithMetadata,
} from "../preferences-service.js";
import { validatePreference } from "../preferences-service.js";
import {
  PreferenceKey,
  PreferenceValue,
  type IPartialPreferences,
} from "../preferences-types.js";
import {
  ONBOARDING_BLANKET_OPTIONS,
  ONBOARDING_CHOICE_GROUPS,
  ONBOARDING_MAX_OFFERS,
  ONBOARDING_PRIMER_BULLETS,
  ONBOARDING_PRIMER_HEADLINE,
  ONBOARDING_TOGGLE_GROUPS,
  ONBOARDING_TOGGLE_PROMPT,
  ONBOARDING_UNSELECTED_TOGGLE_VALUE,
} from "./onboarding-constants.js";
import {
  OnboardingBlanketChoice,
  OnboardingGroupKind,
  type IOnboardingAnswers,
  type IOnboardingApplyResult,
  type IOnboardingGroup,
  type IOnboardingPlan,
  type IOnboardingSkipResult,
} from "./onboarding-types.js";

/**
 * Whether the first-run walkthrough still owes the user a prompt.
 * @param dataDirOverride - Override data dir for testing.
 */
export function needsOnboarding(dataDirOverride?: string): boolean {
  const completedAt = readPreferencesMetadata(dataDirOverride).onboardingCompletedAt;
  return typeof completedAt !== "string" || completedAt.length === 0;
}

/**
 * Every preference key presented as a toggle, in presentation order.
 */
export function getOnboardingToggleKeys(): PreferenceKey[] {
  return ONBOARDING_TOGGLE_GROUPS.flatMap((group) => group.keys);
}

/**
 * Build the full walkthrough: primer, blanket dispositions, and per-group questions.
 *
 * Copy for each key is resolved from `PREFERENCES_SCHEMA` and defaults from
 * `DEFAULT_PREFERENCES`, so adding a preference never leaves the walkthrough stale.
 */
export function buildOnboardingPlan(): IOnboardingPlan {
  const toggleGroups: IOnboardingGroup[] = ONBOARDING_TOGGLE_GROUPS.map((group) => ({
    kind: OnboardingGroupKind.Toggle,
    header: group.header,
    prompt: ONBOARDING_TOGGLE_PROMPT,
    entries: group.keys.map((key) => ({
      key: key,
      description: PREFERENCES_SCHEMA[key].description,
      isSelectedByDefault: DEFAULT_PREFERENCES[key] === PreferenceValue.Always,
    })),
  }));

  const choiceGroups: IOnboardingGroup[] = ONBOARDING_CHOICE_GROUPS.map((group) => ({
    kind: OnboardingGroupKind.Choice,
    header: group.header,
    prompt: group.prompt,
    key: group.key,
    description: PREFERENCES_SCHEMA[group.key].description,
    options: group.optionLabels.map((option) => ({
      label: option.label,
      value: option.value,
      isDefault: DEFAULT_PREFERENCES[group.key] === option.value,
    })),
  }));

  return {
    primerHeadline: ONBOARDING_PRIMER_HEADLINE,
    primerBullets: [...ONBOARDING_PRIMER_BULLETS],
    blanketOptions: [...ONBOARDING_BLANKET_OPTIONS],
    groups: [...toggleGroups, ...choiceGroups],
  };
}

/**
 * Resolve a blanket disposition into the preferences it writes.
 *
 * `AskEverything` falls back to a key's default wherever `ask` is not one of its
 * allowed values — `watcherLifetime` takes a duration, so there is nothing to ask.
 *
 * @param choice - The disposition the user picked.
 */
export function resolveBlanketPreferences(choice: OnboardingBlanketChoice): IPartialPreferences {
  if (choice === OnboardingBlanketChoice.AskEverything) {
    const prefs: IPartialPreferences = {};
    for (const key of Object.values(PreferenceKey)) {
      prefs[key] = PREFERENCE_ALLOWED_VALUES[key].includes(PreferenceValue.Ask)
        ? PreferenceValue.Ask
        : DEFAULT_PREFERENCES[key];
    }
    return prefs;
  }

  return { ...DEFAULT_PREFERENCES };
}

/**
 * What a toggle the user left off resolves to.
 *
 * Normally `ask` — declining to automate something means "check with me". A key whose
 * recommended value is already `never` is the exception: it has no gate to prompt at,
 * so `ask` would be unrepresentable, and its default is the quiet one either way.
 */
function resolveUnselectedValue(key: PreferenceKey): PreferenceValue {
  return DEFAULT_PREFERENCES[key] === PreferenceValue.Never
    ? PreferenceValue.Never
    : ONBOARDING_UNSELECTED_TOGGLE_VALUE;
}

/**
 * Resolve toggle-group selections into preferences.
 *
 * @param selectedKeys - Keys the user toggled on; every other toggle key is set to `ask`.
 */
export function resolveTogglePreferences(selectedKeys: readonly PreferenceKey[]): IPartialPreferences {
  const selected = new Set(selectedKeys);
  const prefs: IPartialPreferences = {};

  for (const key of getOnboardingToggleKeys()) {
    prefs[key] = selected.has(key) ? PreferenceValue.Always : resolveUnselectedValue(key);
  }

  return prefs;
}

/**
 * Record a completed walkthrough: the chosen preferences and the completion stamp,
 * written together so a concurrent writer cannot land between them.
 *
 * @param prefs - Preferences the user chose.
 * @param dataDirOverride - Override data dir for testing.
 * @param now - Completion timestamp; defaults to the current time.
 */
export function completeOnboarding(
  prefs: IPartialPreferences,
  dataDirOverride?: string,
  now: Date = new Date(),
): void {
  writePreferencesWithMetadata(
    prefs,
    { onboardingCompletedAt: now.toISOString() },
    dataDirOverride,
  );
}

/**
 * Record a declined offer. Once the cap is reached the walkthrough retires itself
 * so a user who keeps declining is never asked again.
 *
 * @param dataDirOverride - Override data dir for testing.
 * @param now - Retirement timestamp; defaults to the current time.
 */
export function recordOnboardingSkip(
  dataDirOverride?: string,
  now: Date = new Date(),
): IOnboardingSkipResult {
  const offerCount = (readPreferencesMetadata(dataDirOverride).onboardingOfferCount ?? 0) + 1;
  const isRetired = offerCount >= ONBOARDING_MAX_OFFERS;

  writePreferencesWithMetadata(
    {},
    {
      onboardingOfferCount: offerCount,
      ...(isRetired ? { onboardingCompletedAt: now.toISOString() } : {}),
    },
    dataDirOverride,
  );

  return { offerCount: offerCount, isRetired: isRetired };
}

/**
 * Mark the walkthrough finished without changing any preference — used when the
 * installer backfills an existing user who was never offered it.
 *
 * @param dataDirOverride - Override data dir for testing.
 * @param now - Completion timestamp; defaults to the current time.
 */
export function markOnboardingCompleted(dataDirOverride?: string, now: Date = new Date()): void {
  writePreferencesWithMetadata({}, { onboardingCompletedAt: now.toISOString() }, dataDirOverride);
}

/**
 * Resolve a front-end's answers into the preferences they mean.
 *
 * @param answers - What the user picked.
 * @throws When a choice names an unknown key or a value that key does not allow.
 */
export function resolveOnboardingAnswers(answers: IOnboardingAnswers): IPartialPreferences {
  if (answers.blanket === OnboardingBlanketChoice.Skip) {
    return {};
  }

  if (answers.blanket !== OnboardingBlanketChoice.Customize) {
    return resolveBlanketPreferences(answers.blanket);
  }

  const prefs = resolveTogglePreferences(answers.selectedToggleKeys ?? []);

  for (const [key, value] of Object.entries(answers.choices ?? {})) {
    if (!validatePreference(key, value)) {
      throw new Error(`Invalid onboarding choice: ${key}=${value}`);
    }
    prefs[key as PreferenceKey] = value;
  }

  return prefs;
}

/**
 * Resolve and persist a front-end's answers.
 *
 * A skip records a declined offer and writes no preference values; anything else
 * writes the resolved preferences and the completion stamp in one pass.
 *
 * @param answers - What the user picked.
 * @param dataDirOverride - Override data dir for testing.
 * @param now - Timestamp used for the completion stamp; defaults to the current time.
 */
export function applyOnboardingAnswers(
  answers: IOnboardingAnswers,
  dataDirOverride?: string,
  now: Date = new Date(),
): IOnboardingApplyResult {
  if (answers.blanket === OnboardingBlanketChoice.Skip) {
    const skip = recordOnboardingSkip(dataDirOverride, now);
    return { isCompleted: skip.isRetired, preferences: {}, skip: skip };
  }

  const prefs = resolveOnboardingAnswers(answers);
  completeOnboarding(prefs, dataDirOverride, now);
  return { isCompleted: true, preferences: prefs };
}
