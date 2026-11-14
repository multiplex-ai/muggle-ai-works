/**
 * Zod schemas for the local taste journal and profile MCP tools.
 */

import { z } from "zod";

import { TasteCategory, TasteSignalKind } from "../../../shared/taste-profile/types.js";

const isoDateTimeSchema = z.string().datetime({ offset: true });

/** One distilled preference line. */
export const TastePreferenceSchema = z.object({
  statement: z.string().trim().min(1).describe("The taste, phrased as guidance for a test run."),
  category: z.nativeEnum(TasteCategory).describe("Area of taste the preference speaks to."),
  signalCount: z.number().int().min(1).describe("How many journal signals support it."),
  lastSeenAt: isoDateTimeSchema.describe("ISO-8601 time of the newest supporting signal."),
});

/** A user-wide or per-project section. */
export const TasteSectionSchema = z.object({
  preferences: z
    .array(TastePreferenceSchema)
    .describe("Preferences ranked by signal count, then recency; statements total at most 4,000 characters."),
  distilledAt: isoDateTimeSchema.describe("ISO-8601 time the section was distilled."),
});

/** Input for muggle-local-taste-signal-append. */
export const TasteSignalAppendInputSchema = z.object({
  kind: z.nativeEnum(TasteSignalKind).describe("Flow the signal came from."),
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
