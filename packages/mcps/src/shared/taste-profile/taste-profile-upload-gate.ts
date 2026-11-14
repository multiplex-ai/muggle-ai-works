/**
 * Consent gate for uploading the taste profile, driven by the `tasteProfileUpload` preference.
 */

import { PreferenceValue } from "../preferences-types.js";
import { TasteProfileUploadDecision } from "./types.js";

/**
 * Decide whether an upload may proceed.
 * @param tasteProfileUploadPreference - Resolved value of `tasteProfileUpload`.
 * @param hasUserApprovedThisUpload - Whether the user approved this upload in the gate's picker.
 * @returns `refuse` under `never`, `upload` under `always` or an approved `ask`, else `needs-consent`.
 */
export function resolveTasteProfileUploadDecision(
  tasteProfileUploadPreference: PreferenceValue,
  hasUserApprovedThisUpload: boolean,
): TasteProfileUploadDecision {
  if (tasteProfileUploadPreference === PreferenceValue.Never) {
    return TasteProfileUploadDecision.Refuse;
  }
  if (tasteProfileUploadPreference === PreferenceValue.Always || hasUserApprovedThisUpload) {
    return TasteProfileUploadDecision.Upload;
  }
  return TasteProfileUploadDecision.NeedsConsent;
}
