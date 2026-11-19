/**
 * Zod schemas for the local taste journal and profile MCP tools.
 */

import { z } from "zod";

import {
  TASTE_EVIDENCE_EXCERPT_MAX_CHARACTERS,
  TASTE_EVIDENCE_MAX_PER_PREFERENCE,
} from "../../../shared/taste-profile/constants.js";
import { TasteCategory, TasteDiscipline, TasteSignalKind } from "../../../shared/taste-profile/types.js";

const isoDateTimeSchema = z.string().datetime({ offset: true });

// The section schema is inlined twice in the set tool's JSON schema (user and project sections), and Codex
// strips every argument description past 5,000 bytes, so field descriptions stay minimal; the set tool's
// description carries the rest.

/** One signal a preference rests on. */
export const TasteEvidenceSchema = z.object({
  kind: z.nativeEnum(TasteSignalKind),
  excerpt: z
    .string()
    .trim()
    .min(1)
    .max(TASTE_EVIDENCE_EXCERPT_MAX_CHARACTERS)
    .describe("User's own words; uploaded after screening."),
  sourceRef: z.string().min(1).optional(),
  recordedAt: isoDateTimeSchema,
});

/** One distilled preference: the conclusion, where it holds, and what it rests on. */
export const TastePreferenceSchema = z.object({
  statement: z.string().trim().min(1).describe("The conclusion."),
  appliesWhen: z.string().trim().min(1).describe("Where it holds; runs apply it only there."),
  evidence: z.array(TasteEvidenceSchema).min(1).max(TASTE_EVIDENCE_MAX_PER_PREFERENCE),
  category: z.nativeEnum(TasteCategory),
  discipline: z.nativeEnum(TasteDiscipline),
  signalCount: z.number().int().min(1),
  lastSeenAt: isoDateTimeSchema,
});

/** A user-wide or per-project section. */
export const TasteSectionSchema = z.object({
  preferences: z.array(TastePreferenceSchema),
  distilledAt: isoDateTimeSchema,
});

/** Input for muggle-local-taste-signal-append. */
export const TasteSignalAppendInputSchema = z.object({
  kind: z.nativeEnum(TasteSignalKind).describe("Flow the signal came from."),
  discipline: z.nativeEnum(TasteDiscipline).optional().describe("Kind of work the signal came from; omitted counts as WebUi."),
  text: z.string().trim().min(1).describe("The user's own words, or the approved goal and criteria."),
  projectId: z.string().min(1).optional().describe("Muggle Test project the signal belongs to; omit when none."),
  classification: z.string().min(1).optional().describe("How the flow classified it, e.g. actionable or ambiguous."),
  sourceRef: z.string().min(1).optional().describe("Where it came from, e.g. a PR URL or run id."),
});

export type TasteSignalAppendInput = z.infer<typeof TasteSignalAppendInputSchema>;

/** Input for muggle-local-taste-signal-list. */
export const TasteSignalListInputSchema = z.object({
  projectId: z.string().min(1).optional().describe("Only signals for this project."),
  kind: z.nativeEnum(TasteSignalKind).optional().describe("Only signals of this kind."),
  limit: z.number().int().positive().optional().describe("Only the newest N signals."),
});

export type TasteSignalListInput = z.infer<typeof TasteSignalListInputSchema>;

/** Input for muggle-local-taste-profile-set. */
export const TasteProfileSetInputSchema = z
  .object({
    userSection: TasteSectionSchema.optional().describe("Replaces the user-wide section."),
    projectSections: z
      .record(z.string().min(1), TasteSectionSchema)
      .optional()
      .describe("Replaces each named project's section, keyed by Muggle Test project id; other projects are kept."),
  })
  .refine((sectionUpdate) => sectionUpdate.userSection !== undefined || sectionUpdate.projectSections !== undefined, {
    message: "Name userSection, projectSections, or both.",
  });

export type TasteProfileSetInput = z.infer<typeof TasteProfileSetInputSchema>;

/** Input for muggle-local-taste-profile-clear. */
export const TasteProfileClearInputSchema = z.object({
  projectId: z.string().min(1).optional().describe("Clear only this project's section; omit to clear the whole profile."),
});

export type TasteProfileClearInput = z.infer<typeof TasteProfileClearInputSchema>;
