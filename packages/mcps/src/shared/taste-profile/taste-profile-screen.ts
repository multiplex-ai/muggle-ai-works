/**
 * Screens a taste profile for secrets, emails and credentials before it leaves the machine.
 */

import { TASTE_REDACTION_MARKER, TASTE_REDACTION_PATTERNS } from "./constants.js";
import type { ITasteProfile, ITasteProfileScreenResult, ITasteSection } from "./types.js";

function redactStatement(statement: string): { redactedStatement: string; redactionCount: number } {
  let redactionCount = 0;
  let redactedStatement = statement;
  for (const redactionPattern of TASTE_REDACTION_PATTERNS) {
    redactedStatement = redactedStatement.replace(redactionPattern, () => {
      redactionCount += 1;
      return TASTE_REDACTION_MARKER;
    });
  }
  return { redactedStatement: redactedStatement, redactionCount: redactionCount };
}

function screenSection(tasteSection: ITasteSection): { screenedSection: ITasteSection; redactionCount: number } {
  let sectionRedactionCount = 0;
  const screenedPreferences = tasteSection.preferences.map((preference) => {
    const statementScreen = redactStatement(preference.statement);
    sectionRedactionCount += statementScreen.redactionCount;
    return { ...preference, statement: statementScreen.redactedStatement };
  });
  return {
    screenedSection: { ...tasteSection, preferences: screenedPreferences },
    redactionCount: sectionRedactionCount,
  };
}

/**
 * Redact API keys, tokens, JWTs, private keys, emails and password-like `key=value` pairs from
 * every statement. The input is not modified.
 * @param tasteProfile - The profile to screen.
 * @returns The screened copy and how many spans were redacted.
 */
export function screenTasteProfile(tasteProfile: ITasteProfile): ITasteProfileScreenResult {
  let redactionCount = 0;

  let screenedUserSection: ITasteSection | null = null;
  if (tasteProfile.userSection) {
    const userSectionScreen = screenSection(tasteProfile.userSection);
    screenedUserSection = userSectionScreen.screenedSection;
    redactionCount += userSectionScreen.redactionCount;
  }

  const screenedProjectSections: Record<string, ITasteSection> = {};
  for (const [projectId, projectSection] of Object.entries(tasteProfile.projectSections)) {
    const projectSectionScreen = screenSection(projectSection);
    screenedProjectSections[projectId] = projectSectionScreen.screenedSection;
    redactionCount += projectSectionScreen.redactionCount;
  }

  return {
    screenedProfile: { userSection: screenedUserSection, projectSections: screenedProjectSections },
    redactionCount: redactionCount,
  };
}
