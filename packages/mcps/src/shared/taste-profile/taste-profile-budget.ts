/**
 * Character budget checks for taste sections.
 */

import { TASTE_SECTION_CHARACTER_BUDGET } from "./constants.js";
import { listNamedTasteSections } from "./taste-named-sections.js";
import type {
  ITastePreference,
  ITasteProfileSectionUpdate,
  ITasteSection,
  ITasteSectionBudgetViolation,
} from "./types.js";

function countPreferenceCharacters(preference: ITastePreference): number {
  return (
    preference.statement.length +
    preference.appliesWhen.length +
    preference.evidence.reduce((characterCount, evidence) => characterCount + evidence.excerpt.length, 0)
  );
}

/**
 * Total characters of a section's statements, contexts and evidence excerpts, the text a run renders into its prompt.
 * @param tasteSection - The section to measure.
 * @returns The summed length.
 */
export function countSectionCharacters(tasteSection: ITasteSection): number {
  return tasteSection.preferences.reduce(
    (characterCount, preference) => characterCount + countPreferenceCharacters(preference),
    0,
  );
}

/**
 * Sections whose text exceeds the per-section budget.
 * @param sectionUpdate - Sections to check; a full profile qualifies once its null user section is dropped.
 * @returns One entry per section over budget; empty when all fit.
 */
export function findOverBudgetSections(sectionUpdate: ITasteProfileSectionUpdate): ITasteSectionBudgetViolation[] {
  return listNamedTasteSections(sectionUpdate)
    .map(([sectionName, tasteSection]) => ({
      sectionName: sectionName,
      characterCount: countSectionCharacters(tasteSection),
    }))
    .filter((sectionMeasure) => sectionMeasure.characterCount > TASTE_SECTION_CHARACTER_BUDGET);
}
