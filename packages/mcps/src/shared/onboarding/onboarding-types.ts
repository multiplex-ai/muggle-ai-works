/**
 * Type definitions for the first-run onboarding walkthrough.
 */

import type { PreferenceKey, PreferenceValue } from "../preferences-types.js";

/**
 * How a group of preferences is presented to the user.
 */
export enum OnboardingGroupKind {
  /** Several keys shown together; each is toggled on (`always`) or left off. */
  Toggle = "toggle",
  /** A single key with mutually exclusive domain-specific values. */
  Choice = "choice",
}

/**
 * The blanket dispositions offered before the per-group questions.
 */
export enum OnboardingBlanketChoice {
  /** Write the recommended defaults and finish immediately. */
  AcceptDefaults = "accept-defaults",
  /** Set every key to `ask` so nothing proceeds unattended. */
  AskEverything = "ask-everything",
  /** Continue into the per-group questions. */
  Customize = "customize",
  /** Decline for now; the offer repeats until the cap is reached. */
  Skip = "skip",
}

/**
 * One selectable value within a choice group.
 */
export interface IOnboardingChoiceOption {
  /** Text shown to the user. */
  label: string;
  /** Preference value applied when this option wins. */
  value: PreferenceValue;
  /** Whether this option is pre-selected. */
  isDefault: boolean;
}

/**
 * One toggleable preference within a toggle group.
 */
export interface IOnboardingToggleEntry {
  /** Preference key this entry writes. */
  key: PreferenceKey;
  /** Text shown to the user, taken from the preference schema. */
  description: string;
  /** Whether this entry starts toggled on. */
  isSelectedByDefault: boolean;
}

/**
 * A group of preferences toggled together.
 */
export interface IOnboardingToggleGroup {
  /** Discriminant. */
  kind: OnboardingGroupKind.Toggle;
  /** Short group name. */
  header: string;
  /** Question text shown above the entries. */
  prompt: string;
  /** Preferences offered in this group. */
  entries: IOnboardingToggleEntry[];
}

/**
 * A single preference with mutually exclusive values.
 */
export interface IOnboardingChoiceGroup {
  /** Discriminant. */
  kind: OnboardingGroupKind.Choice;
  /** Short group name. */
  header: string;
  /** Question text shown above the options. */
  prompt: string;
  /** Preference key this group writes. */
  key: PreferenceKey;
  /** Explanation of what the key gates, taken from the preference schema. */
  description: string;
  /** Values the user picks between. */
  options: IOnboardingChoiceOption[];
}

/**
 * Either kind of group, discriminated by `kind`.
 */
export type IOnboardingGroup = IOnboardingToggleGroup | IOnboardingChoiceGroup;

/**
 * A blanket disposition as presented to the user.
 */
export interface IOnboardingBlanketOption {
  /** Disposition applied when this option wins. */
  choice: OnboardingBlanketChoice;
  /** Text shown to the user. */
  label: string;
  /** What picking this option does. */
  description: string;
}

/**
 * Everything a front-end needs to render the walkthrough.
 *
 * Output shape:
 * `{ primerHeadline: "Muggle Test drives...", primerBullets: [...], blanketOptions: [...], groups: [...] }`
 */
export interface IOnboardingPlan {
  /** Opening sentence shown before any question. */
  primerHeadline: string;
  /** Supporting points shown under the headline. */
  primerBullets: string[];
  /** Dispositions offered before the per-group questions. */
  blanketOptions: IOnboardingBlanketOption[];
  /** Per-group questions, in presentation order. */
  groups: IOnboardingGroup[];
}

/**
 * Layout entry describing one group's membership, independent of copy
 * resolved from the preference schema.
 */
export interface IOnboardingGroupLayout {
  /** Short group name. */
  header: string;
  /** Preference keys belonging to this group. */
  keys: PreferenceKey[];
}

/**
 * Result of recording a declined offer.
 */
export interface IOnboardingSkipResult {
  /** How many times the walkthrough has now been declined. */
  offerCount: number;
  /** Whether the cap was reached and the walkthrough retired. */
  isRetired: boolean;
}

/**
 * One option label within a choice group's layout.
 */
export interface IOnboardingChoiceOptionLabel {
  /** Preference value this label describes. */
  value: PreferenceValue;
  /** Text shown to the user. */
  label: string;
}

/**
 * Layout entry for a single-key choice group.
 */
export interface IOnboardingChoiceLayout {
  /** Short group name. */
  header: string;
  /** Preference key this group writes. */
  key: PreferenceKey;
  /** Question text shown above the options. */
  prompt: string;
  /** Labels for each allowed value, in presentation order. */
  optionLabels: IOnboardingChoiceOptionLabel[];
}

/**
 * A user's raw answers to the walkthrough, as reported by any front-end.
 *
 * Front-ends report what was picked, never resolved preference values — mapping
 * selections onto preferences belongs to the service so both surfaces agree.
 */
export interface IOnboardingAnswers {
  /** The blanket disposition picked before the per-group questions. */
  blanket: OnboardingBlanketChoice;
  /** Toggle keys switched on. Only read when `blanket` is `Customize`. */
  selectedToggleKeys?: PreferenceKey[];
  /** Values picked in choice groups. Only read when `blanket` is `Customize`. */
  choices?: Partial<Record<PreferenceKey, PreferenceValue>>;
}

/**
 * Outcome of persisting a set of answers.
 */
export interface IOnboardingApplyResult {
  /** Whether the walkthrough was recorded as complete. */
  isCompleted: boolean;
  /** Preferences written; empty when the user skipped. */
  preferences: Partial<Record<PreferenceKey, PreferenceValue>>;
  /** Set when the user skipped, describing the declined-offer tally. */
  skip?: IOnboardingSkipResult;
}
