/**
 * Character budget checks for taste sections.
 */

import { TASTE_SECTION_STATEMENT_CHARACTER_BUDGET, TASTE_USER_SECTION_NAME } from "./constants.js";
import type { ITasteProfileSectionUpdate, ITasteSection, ITasteSectionBudgetViolation } from "./types.js";

/**
 * Total characters of a section's statements, the part a run renders into its prompt.
 * @param tasteSection - The section to measure.
 * @returns The summed statement length.
 */
export function countSectionStatementCharacters(tasteSection: ITasteSection): number {
  return tasteSection.preferences.reduce(
    (characterCount, preference) => characterCount + preference.statement.length,
    0,
  );
}

/**
 * Sections whose statements exceed the per-section budget.
 * @param sectionUpdate - Sections to check; a full profile qualifies once its null user section is dropped.
 * @returns One entry per section over budget; empty when all fit.
 */
export function findOverBudgetSections(sectionUpdate: ITasteProfileSectionUpdate): ITasteSectionBudgetViolation[] {
  const namedSections: Array<[string, ITasteSection]> = [
    ...(sectionUpdate.userSection ? [[TASTE_USER_SECTION_NAME, sectionUpdate.userSection] as [string, ITasteSection]] : []),
    ...Object.entries(sectionUpdate.projectSections ?? {}),
  ];
  return namedSections
    .map(([sectionName, tasteSection]) => ({
      sectionName: sectionName,
      statementCharacterCount: countSectionStatementCharacters(tasteSection),
    }))
    .filter((sectionMeasure) => sectionMeasure.statementCharacterCount > TASTE_SECTION_STATEMENT_CHARACTER_BUDGET);
}
