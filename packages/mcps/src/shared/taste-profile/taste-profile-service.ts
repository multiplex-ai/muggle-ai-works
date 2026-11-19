/**
 * Composes the taste profile store, the upload state store and the readable renderer: every change to the
 * profile or its upload state re-renders `profile.md`, which is never read back.
 */

import * as fs from "fs";
import * as path from "path";

import { getTasteProfileViewPath } from "./taste-paths.js";
import { clearTasteProfile, readTasteProfile, writeTasteProfileSections } from "./taste-profile-store.js";
import { renderTasteProfileView } from "./taste-profile-view-renderer.js";
import { clearTasteUploadState, readTasteUploadState, recordTasteSectionUploads } from "./taste-upload-state-store.js";
import { buildTasteSectionUploadStates, resolveTasteProfileUploadReports } from "./taste-upload-status.js";
import type { ITasteProfile, ITasteProfileOverview, ITasteProfileSectionUpdate } from "./types.js";

function renderTasteProfileViewFile(tasteProfile: ITasteProfile, dataDirOverride?: string): void {
  const sectionUploadReports = resolveTasteProfileUploadReports(tasteProfile, readTasteUploadState(dataDirOverride));
  const viewPath = getTasteProfileViewPath(dataDirOverride);
  fs.mkdirSync(path.dirname(viewPath), { recursive: true });
  fs.writeFileSync(viewPath, renderTasteProfileView(tasteProfile, sectionUploadReports), "utf-8");
}

/**
 * Read the local profile.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns The stored profile with every preference's discipline resolved; empty when none is stored.
 */
export function readLocalTasteProfile(dataDirOverride?: string): ITasteProfile {
  return readTasteProfile(dataDirOverride);
}

/**
 * The local profile with each section's upload status and the readable copy's path.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns The overview.
 */
export function getLocalTasteProfileOverview(dataDirOverride?: string): ITasteProfileOverview {
  const tasteProfile = readTasteProfile(dataDirOverride);
  return {
    tasteProfile: tasteProfile,
    sectionUploadReports: resolveTasteProfileUploadReports(tasteProfile, readTasteUploadState(dataDirOverride)),
    viewPath: getTasteProfileViewPath(dataDirOverride),
  };
}

/**
 * Replace the named sections, keep the others, then re-render `profile.md`.
 * @param sectionUpdate - Sections to replace.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns The profile as written.
 */
export function setLocalTasteProfileSections(
  sectionUpdate: ITasteProfileSectionUpdate,
  dataDirOverride?: string,
): ITasteProfile {
  const writtenProfile = writeTasteProfileSections(sectionUpdate, dataDirOverride);
  renderTasteProfileViewFile(writtenProfile, dataDirOverride);
  return writtenProfile;
}

/**
 * Record every section of an uploaded screened profile, then re-render `profile.md`.
 * @param screenedProfile - The screened profile the backend accepted.
 * @param uploadedAt - ISO-8601 upload time.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 */
export function recordTasteProfileUploadAndRender(
  screenedProfile: ITasteProfile,
  uploadedAt: string,
  dataDirOverride?: string,
): void {
  recordTasteSectionUploads(buildTasteSectionUploadStates(screenedProfile, uploadedAt), dataDirOverride);
  renderTasteProfileViewFile(readTasteProfile(dataDirOverride), dataDirOverride);
}

/**
 * Clear the whole local profile with `profile.md` and the upload state, or only one project's section,
 * re-rendering `profile.md` for what remains.
 * @param projectId - When given, only this project's section is removed.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns The profile left on disk (empty after a full clear).
 */
export function clearLocalTasteProfile(projectId?: string, dataDirOverride?: string): ITasteProfile {
  const remainingProfile = clearTasteProfile(projectId, dataDirOverride);
  if (projectId === undefined) {
    clearTasteUploadState(dataDirOverride);
    fs.rmSync(getTasteProfileViewPath(dataDirOverride), { force: true });
    return remainingProfile;
  }
  renderTasteProfileViewFile(remainingProfile, dataDirOverride);
  return remainingProfile;
}