/**
 * Renders the taste profile as the human-readable `profile.md`.
 */

import { TASTE_DISCIPLINE_LABELS, TASTE_SECTION_UPLOAD_STATUS_LABELS, TASTE_USER_SECTION_NAME } from "./constants.js";
import { listNamedTasteSections } from "./taste-named-sections.js";
import {
  TasteSectionUploadStatus,
  type ITasteEvidence,
  type ITastePreference,
  type ITasteProfile,
  type ITasteSection,
  type ITasteSectionUploadReport,
} from "./types.js";

function toSingleLine(multilineText: string): string {
  return multilineText.replace(/\s+/g, " ").trim();
}

function renderUploadLine(uploadReport: ITasteSectionUploadReport | undefined): string {
  if (uploadReport === undefined || uploadReport.status === TasteSectionUploadStatus.NeverUploaded) {
    return `Last uploaded: ${TASTE_SECTION_UPLOAD_STATUS_LABELS[TasteSectionUploadStatus.NeverUploaded]}`;
  }
  return `Last uploaded: ${uploadReport.uploadedAt} — ${TASTE_SECTION_UPLOAD_STATUS_LABELS[uploadReport.status]}`;
}

function renderEvidenceLine(evidence: ITasteEvidence): string {
  const sourceSuffix = evidence.sourceRef === undefined ? "" : `, ${toSingleLine(evidence.sourceRef)}`;
  return `  - "${toSingleLine(evidence.excerpt)}" (${evidence.kind}, ${evidence.recordedAt}${sourceSuffix})`;
}

function renderPreference(preference: ITastePreference): string[] {
  return [
    `#### ${toSingleLine(preference.statement)}`,
    "",
    `- Applies when: ${toSingleLine(preference.appliesWhen)}`,
    `- Category: ${preference.category}`,
    `- Signals: ${preference.signalCount}`,
    `- Last seen: ${preference.lastSeenAt}`,
    "- Evidence:",
    ...preference.evidence.map((evidence) => renderEvidenceLine(evidence)),
    "",
  ];
}

function renderSection(
  sectionName: string,
  tasteSection: ITasteSection,
  uploadReport: ITasteSectionUploadReport | undefined,
): string[] {
  const sectionHeading = sectionName === TASTE_USER_SECTION_NAME ? "User-wide" : `Project ${sectionName}`;
  const sectionLines = [`## ${sectionHeading}`, "", renderUploadLine(uploadReport), `Distilled: ${tasteSection.distilledAt}`, ""];
  if (tasteSection.preferences.length === 0) {
    return [...sectionLines, "No preferences.", ""];
  }

  for (const [discipline, disciplineLabel] of Object.entries(TASTE_DISCIPLINE_LABELS)) {
    const disciplinePreferences = tasteSection.preferences.filter((preference) => preference.discipline === discipline);
    if (disciplinePreferences.length === 0) {
      continue;
    }
    sectionLines.push(`### ${disciplineLabel}`, "");
    for (const preference of disciplinePreferences) {
      sectionLines.push(...renderPreference(preference));
    }
  }
  return sectionLines;
}

/**
 * Markdown view of the profile: the user-wide section, then each project section; inside each, preferences
 * grouped by discipline with their context, category, support and evidence, under a line saying when the
 * section was last uploaded and whether the local copy still matches it.
 * @param tasteProfile - The local profile, with every preference's discipline resolved.
 * @param uploadReports - Upload status keyed by `user` or project id.
 * @returns The markdown document.
 */
export function renderTasteProfileView(
  tasteProfile: ITasteProfile,
  uploadReports: Record<string, ITasteSectionUploadReport>,
): string {
  const viewLines = [
    "# Muggle taste profile",
    "",
    "Readable copy of `profile.json`, rewritten on every change. Edit the profile with /muggle-taste-profile; changes made here are not read back.",
    "",
  ];
  const namedSections = listNamedTasteSections(tasteProfile);
  if (namedSections.length === 0) {
    viewLines.push("No sections yet. Build the profile with /muggle-taste-profile.", "");
  }
  for (const [sectionName, tasteSection] of namedSections) {
    viewLines.push(...renderSection(sectionName, tasteSection, uploadReports[sectionName]));
  }
  return `${viewLines.join("\n").trimEnd()}\n`;
}