/**
 * Screens a taste profile for secrets, emails and credentials before it leaves the machine.
 */

import { TASTE_REDACTION_MARKER, TASTE_REDACTION_PATTERNS } from "./constants.js";
import type { ITasteProfile, ITasteProfileScreenResult, ITasteSection, ITasteSectionScreenResult } from "./types.js";

/**
 * Redact one section's statements, contexts, evidence excerpts and evidence sources. The input is not modified.
 * @param tasteSection - The section to screen.
 * @returns The screened copy and how many spans were redacted.
 */
export function screenTasteSection(tasteSection: ITasteSection): ITasteSectionScreenResult {
  let sectionRedactionCount = 0;
  const redactText = (uploadedText: string): string => {
    let redactedText = uploadedText;
    for (const redactionPattern of TASTE_REDACTION_PATTERNS) {
      redactedText = redactedText.replace(redactionPattern, () => {
        sectionRedactionCount += 1;
        return TASTE_REDACTION_MARKER;
      });
    }
    return redactedText;
  };

  const screenedPreferences = tasteSection.preferences.map((preference) => ({
    ...preference,
    statement: redactText(preference.statement),
    appliesWhen: redactText(preference.appliesWhen),
    evidence: preference.evidence.map((evidence) => ({
      ...evidence,
      excerpt: redactText(evidence.excerpt),
      ...(evidence.sourceRef === undefined ? {} : { sourceRef: redactText(evidence.sourceRef) }),
    })),
  }));
  return {
    screenedSection: { ...tasteSection, preferences: screenedPreferences },
    redactionCount: sectionRedactionCount,
  };
}

/**
 * Redact API keys, tokens, JWTs, private keys, emails and password-like `key=value` pairs from
 * every statement, context, evidence excerpt and evidence source. The input is not modified.
 * @param tasteProfile - The profile to screen.
 * @returns The screened copy and how many spans were redacted.
 */
export function screenTasteProfile(tasteProfile: ITasteProfile): ITasteProfileScreenResult {
  let redactionCount = 0;

  let screenedUserSection: ITasteSection | null = null;
  if (tasteProfile.userSection) {
    const userSectionScreen = screenTasteSection(tasteProfile.userSection);
    screenedUserSection = userSectionScreen.screenedSection;
    redactionCount += userSectionScreen.redactionCount;
  }

  const screenedProjectSections: Record<string, ITasteSection> = {};
  for (const [projectId, projectSection] of Object.entries(tasteProfile.projectSections)) {
    const projectSectionScreen = screenTasteSection(projectSection);
    screenedProjectSections[projectId] = projectSectionScreen.screenedSection;
    redactionCount += projectSectionScreen.redactionCount;
  }

  return {
    screenedProfile: { userSection: screenedUserSection, projectSections: screenedProjectSections },
    redactionCount: redactionCount,
  };
}
