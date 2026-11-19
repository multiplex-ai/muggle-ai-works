/**
 * Compares local taste sections with the copy last uploaded for each.
 */

import { createHash } from "crypto";

import { listNamedTasteSections } from "./taste-named-sections.js";
import { screenTasteSection } from "./taste-profile-screen.js";
import {
  TasteSectionUploadStatus,
  type ITasteProfile,
  type ITasteSection,
  type ITasteSectionUploadReport,
  type ITasteSectionUploadState,
  type TasteUploadState,
} from "./types.js";

function toCanonicalJson(serializable: unknown): string {
  if (Array.isArray(serializable)) {
    return `[${serializable.map((element) => toCanonicalJson(element)).join(",")}]`;
  }
  if (typeof serializable === "object" && serializable !== null) {
    const sortedEntries = Object.entries(serializable as Record<string, unknown>)
      .filter(([, fieldValue]) => fieldValue !== undefined)
      .sort(([leftKey], [rightKey]) => (leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0));
    return `{${sortedEntries.map(([fieldKey, fieldValue]) => `${JSON.stringify(fieldKey)}:${toCanonicalJson(fieldValue)}`).join(",")}}`;
  }
  return JSON.stringify(serializable);
}


/**
 * Hash of a screened section's preferences, independent of key order. `distilledAt` is left out so a
 * rebuild that yields the same preferences still matches the uploaded copy.
 * @param screenedSection - A section already passed through the screen.
 * @returns Hex SHA-256 digest.
 */
export function hashScreenedTasteSection(screenedSection: ITasteSection): string {
  return createHash("sha256").update(toCanonicalJson(screenedSection.preferences)).digest("hex");
}

/**
 * Upload state for every section of a screened profile that is being uploaded.
 * @param screenedProfile - The screened profile sent to the backend.
 * @param uploadedAt - ISO-8601 upload time.
 * @returns State keyed by `user` or project id.
 */
export function buildTasteSectionUploadStates(screenedProfile: ITasteProfile, uploadedAt: string): TasteUploadState {
  return Object.fromEntries(
    listNamedTasteSections(screenedProfile).map(([sectionName, screenedSection]) => [
      sectionName,
      { uploadedAt: uploadedAt, screenedSectionHash: hashScreenedTasteSection(screenedSection) },
    ]),
  );
}

/**
 * How one local section compares with what was last uploaded for it.
 * @param tasteSection - The local, unscreened section.
 * @param sectionUploadState - What was last uploaded for it, if anything.
 * @returns The status and, once uploaded, when.
 */
export function resolveTasteSectionUploadReport(
  tasteSection: ITasteSection,
  sectionUploadState: ITasteSectionUploadState | undefined,
): ITasteSectionUploadReport {
  if (sectionUploadState === undefined) {
    return { status: TasteSectionUploadStatus.NeverUploaded };
  }
  const currentHash = hashScreenedTasteSection(screenTasteSection(tasteSection).screenedSection);
  return {
    status:
      currentHash === sectionUploadState.screenedSectionHash
        ? TasteSectionUploadStatus.MatchesUploadedCopy
        : TasteSectionUploadStatus.ChangedSinceUpload,
    uploadedAt: sectionUploadState.uploadedAt,
  };
}

/**
 * Upload status of every section in the local profile.
 * @param tasteProfile - The local profile.
 * @param uploadState - Recorded upload state.
 * @returns Report keyed by `user` or project id.
 *
 * Output shape: `{ user: { status: "matches-uploaded-copy", uploadedAt: "..." }, p1: { status: "never-uploaded" } }`
 */
export function resolveTasteProfileUploadReports(
  tasteProfile: ITasteProfile,
  uploadState: TasteUploadState,
): Record<string, ITasteSectionUploadReport> {
  return Object.fromEntries(
    listNamedTasteSections(tasteProfile).map(([sectionName, tasteSection]) => [
      sectionName,
      resolveTasteSectionUploadReport(tasteSection, uploadState[sectionName]),
    ]),
  );
}