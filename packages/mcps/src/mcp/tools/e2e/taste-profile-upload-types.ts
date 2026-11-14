/**
 * Shapes for the taste profile upload tool.
 */

import type { ITasteProfile, ITasteSectionBudgetViolation } from "../../../shared/taste-profile/types.js";

/** What happened to one upload attempt. */
export enum TasteProfileUploadOutcome {
  /** The screened profile was sent. */
  Uploaded = "uploaded",
  /** `tasteProfileUpload` is `ask` and this upload was not approved; run the gate's picker. */
  NeedsConsent = "needs-consent",
  /** `tasteProfileUpload` is `never`; nothing was sent. */
  Refused = "refused",
  /** The local profile has no section to send. */
  NothingToUpload = "nothing-to-upload",
  /** A section's statements exceed the character budget; nothing was sent. */
  OverBudget = "over-budget",
}

/** Options for one upload attempt. */
export interface ITasteProfileUploadRequest {
  hasUserApprovedThisUpload: boolean;
  correlationId: string;
  /** Muggle home directory to use instead of `~/.muggle-ai` (tests). */
  dataDirOverride?: string;
}

/**
 * Result of one upload attempt.
 *
 * Output shape: `{ outcome: "uploaded", message: "...", redactionCount: 1, uploadedProjectIds: ["p1"], hasUploadedUserSection: true, remoteProfile: {...} }`
 */
export interface ITasteProfileUploadResult {
  outcome: TasteProfileUploadOutcome;
  message: string;
  /** Spans redacted by the screen; present once the profile was screened. */
  redactionCount?: number;
  hasUploadedUserSection?: boolean;
  uploadedProjectIds?: string[];
  overBudgetSections?: ITasteSectionBudgetViolation[];
  /** The profile the backend holds after the upload. */
  remoteProfile?: unknown;
  /** The screened profile that was, or would be, sent. */
  screenedProfile?: ITasteProfile;
}
