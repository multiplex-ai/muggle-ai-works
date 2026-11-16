/**
 * Local store of the distilled taste profile (`~/.muggle-ai/taste/profile.json`).
 */

import * as fs from "fs";
import * as path from "path";

import { getTasteProfilePath } from "./taste-paths.js";
import type { ITasteProfile, ITasteProfileSectionUpdate } from "./types.js";

/**
 * A profile with no sections.
 * @returns `{ userSection: null, projectSections: {} }`.
 */
export function createEmptyTasteProfile(): ITasteProfile {
  return { userSection: null, projectSections: {} };
}

/**
 * Whether a profile holds no section at all.
 * @param tasteProfile - The profile to inspect.
 * @returns True when there is neither a user-wide nor any project section.
 */
export function isTasteProfileEmpty(tasteProfile: ITasteProfile): boolean {
  return tasteProfile.userSection === null && Object.keys(tasteProfile.projectSections).length === 0;
}

/**
 * Read the local profile.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns The stored profile, or an empty one when the file is missing or unreadable.
 */
export function readTasteProfile(dataDirOverride?: string): ITasteProfile {
  const profilePath = getTasteProfilePath(dataDirOverride);
  try {
    if (!fs.existsSync(profilePath)) {
      return createEmptyTasteProfile();
    }
    const storedProfile = JSON.parse(fs.readFileSync(profilePath, "utf-8")) as Partial<ITasteProfile>;
    return {
      userSection: storedProfile.userSection ?? null,
      projectSections: storedProfile.projectSections ?? {},
    };
  } catch {
    return createEmptyTasteProfile();
  }
}

function writeTasteProfile(tasteProfile: ITasteProfile, dataDirOverride?: string): void {
  const profilePath = getTasteProfilePath(dataDirOverride);
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  fs.writeFileSync(profilePath, `${JSON.stringify(tasteProfile, null, 2)}\n`, "utf-8");
}

/**
 * Replace each section the update names and keep the others, as the backend's PUT does.
 * @param sectionUpdate - Sections to replace.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns The profile as written.
 */
export function writeTasteProfileSections(
  sectionUpdate: ITasteProfileSectionUpdate,
  dataDirOverride?: string,
): ITasteProfile {
  const storedProfile = readTasteProfile(dataDirOverride);
  const updatedProfile: ITasteProfile = {
    userSection: sectionUpdate.userSection ?? storedProfile.userSection,
    projectSections: { ...storedProfile.projectSections, ...(sectionUpdate.projectSections ?? {}) },
  };
  writeTasteProfile(updatedProfile, dataDirOverride);
  return updatedProfile;
}

/**
 * Remove the whole local profile, or only one project's section.
 * @param projectId - When given, only this project's section is removed.
 * @param dataDirOverride - Muggle home directory to use instead of `~/.muggle-ai` (tests).
 * @returns The profile left on disk (empty after a full clear).
 */
export function clearTasteProfile(projectId?: string, dataDirOverride?: string): ITasteProfile {
  if (projectId === undefined) {
    fs.rmSync(getTasteProfilePath(dataDirOverride), { force: true });
    return createEmptyTasteProfile();
  }

  const storedProfile = readTasteProfile(dataDirOverride);
  const remainingProjectSections = { ...storedProfile.projectSections };
  delete remainingProjectSections[projectId];
  const remainingProfile: ITasteProfile = {
    userSection: storedProfile.userSection,
    projectSections: remainingProjectSections,
  };
  writeTasteProfile(remainingProfile, dataDirOverride);
  return remainingProfile;
}
