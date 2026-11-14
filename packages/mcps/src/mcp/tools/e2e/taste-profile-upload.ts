/**
 * Uploads the local taste profile after the consent gate and the secret screen.
 */

import { getCallerCredentialsAsync } from "../../../shared/auth.js";
import { resolvePreferences } from "../../../shared/preferences-service.js";
import { PreferenceKey } from "../../../shared/preferences-types.js";
import {
  findOverBudgetSections,
  isTasteProfileEmpty,
  readTasteProfile,
  resolveTasteProfileUploadDecision,
  screenTasteProfile,
  TasteProfileUploadDecision,
  type ITasteProfileSectionUpdate,
} from "../../../shared/taste-profile/index.js";
import { getPromptServiceClient } from "../../e2e/upstream-client.js";
import {
  TasteProfileUploadOutcome,
  type ITasteProfileUploadRequest,
  type ITasteProfileUploadResult,
} from "./taste-profile-upload-types.js";
import { TASTE_PROFILE_PATH } from "./upstream-route-constants.js";

/**
 * Read the local profile, apply the `tasteProfileUpload` gate, screen it and PUT every section it holds.
 * @param uploadRequest - Consent for this upload, the correlation id, and an optional data dir.
 * @returns The outcome; only `uploaded` means anything left the machine.
 * @throws GatewayError when the backend call fails.
 */
export async function uploadTasteProfileAsync(
  uploadRequest: ITasteProfileUploadRequest,
): Promise<ITasteProfileUploadResult> {
  const localProfile = readTasteProfile(uploadRequest.dataDirOverride);
  if (isTasteProfileEmpty(localProfile)) {
    return {
      outcome: TasteProfileUploadOutcome.NothingToUpload,
      message: "The local taste profile is empty. Build it with /muggle-taste-profile first.",
    };
  }

  const uploadPreference = resolvePreferences(uploadRequest.dataDirOverride)[PreferenceKey.TasteProfileUpload];
  const uploadDecision = resolveTasteProfileUploadDecision(uploadPreference, uploadRequest.hasUserApprovedThisUpload);
  if (uploadDecision === TasteProfileUploadDecision.Refuse) {
    return {
      outcome: TasteProfileUploadOutcome.Refused,
      message: "tasteProfileUpload is set to never, so the profile stays on this machine. Change: /muggle-preferences tasteProfileUpload.",
    };
  }

  const screenResult = screenTasteProfile(localProfile);
  if (uploadDecision === TasteProfileUploadDecision.NeedsConsent) {
    return {
      outcome: TasteProfileUploadOutcome.NeedsConsent,
      message: "tasteProfileUpload is set to ask. Run its picker, then call again with hasUserApprovedThisUpload: true if the user agreed.",
      redactionCount: screenResult.redactionCount,
      screenedProfile: screenResult.screenedProfile,
    };
  }

  const sectionUpdate: ITasteProfileSectionUpdate = {
    ...(screenResult.screenedProfile.userSection ? { userSection: screenResult.screenedProfile.userSection } : {}),
    ...(Object.keys(screenResult.screenedProfile.projectSections).length > 0
      ? { projectSections: screenResult.screenedProfile.projectSections }
      : {}),
  };
  const overBudgetSections = findOverBudgetSections(sectionUpdate);
  if (overBudgetSections.length > 0) {
    return {
      outcome: TasteProfileUploadOutcome.OverBudget,
      message: "Some sections exceed the 4,000-character budget. Rebuild them shorter, then upload again.",
      redactionCount: screenResult.redactionCount,
      overBudgetSections: overBudgetSections,
    };
  }

  const credentials = await getCallerCredentialsAsync();
  const upstreamResponse = await getPromptServiceClient().execute(
    { method: "PUT", path: TASTE_PROFILE_PATH, body: sectionUpdate },
    credentials,
    uploadRequest.correlationId,
  );

  return {
    outcome: TasteProfileUploadOutcome.Uploaded,
    message: "Uploaded the screened taste profile. Muggle Test runs now use it as guidance.",
    redactionCount: screenResult.redactionCount,
    hasUploadedUserSection: sectionUpdate.userSection !== undefined,
    uploadedProjectIds: Object.keys(sectionUpdate.projectSections ?? {}),
    remoteProfile: upstreamResponse.data,
  };
}
