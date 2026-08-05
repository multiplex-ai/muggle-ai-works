/**
 * Types for reconciling a superseded per-project preferences file against the
 * global one. Separate from the preference vocabulary itself, which outlives
 * this reconciliation.
 */

import { PreferenceKey } from "./preferences-types.js";

/**
 * Outcome of reconciling a per-project preferences file against the global one.
 */
export enum ProjectPreferencesReconcileOutcome {
  /** No project file, or every key in it already matches the resolved global value. */
  NoAction = "noAction",
  /** Global preferences did not exist, so the project file's keys were copied into them. */
  CopiedToGlobal = "copiedToGlobal",
  /** Global preferences already exist, so the project file's keys no longer take effect. */
  KeysShadowed = "keysShadowed",
}

/**
 * What the reconciliation did, and what the caller should tell the user.
 *
 * Output shape:
 * `{ outcome: "keysShadowed", projectFilePath: "/repo/.muggle-ai/preferences.json", shadowedKeys: ["autoLogin"] }`
 */
export interface IProjectPreferencesReconcileReport {
  /** What the reconciliation did. */
  outcome: ProjectPreferencesReconcileOutcome;
  /** Absolute path of the project preferences file that was inspected. */
  projectFilePath: string;
  /** Keys whose project value differs from the resolved global value. Empty unless the outcome is `KeysShadowed`. */
  shadowedKeys: PreferenceKey[];
}
