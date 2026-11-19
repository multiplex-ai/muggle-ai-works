/**
 * Pairs each taste section with the name used for it in budget reports and upload state.
 */

import { TASTE_USER_SECTION_NAME } from "./constants.js";
import type { ITasteProfile, ITasteProfileSectionUpdate, ITasteSection } from "./types.js";

/**
 * The sections a profile or update holds, user-wide first, then each project in stored order.
 * @param tasteSections - A full profile or a section update.
 * @returns `[sectionName, section]` pairs; `user` names the user-wide section, a project id each project section.
 */
export function listNamedTasteSections(
  tasteSections: ITasteProfile | ITasteProfileSectionUpdate,
): Array<[string, ITasteSection]> {
  return [
    ...(tasteSections.userSection ? [[TASTE_USER_SECTION_NAME, tasteSections.userSection] as [string, ITasteSection]] : []),
    ...Object.entries(tasteSections.projectSections ?? {}),
  ];
}