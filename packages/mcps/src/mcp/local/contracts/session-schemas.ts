/**
 * Zod schemas for session-related tools.
 */

import { z } from "zod";

/**
 * List sessions input schema.
 */
export const ListSessionsInputSchema = z.object({
  limit: z.number().int().positive().optional().describe("Maximum number of sessions to return. Defaults to 10."),
});

export type ListSessionsInput = z.infer<typeof ListSessionsInputSchema>;

/**
 * Cleanup sessions input schema.
 */
export const CleanupSessionsInputSchema = z.object({
  max_age_days: z.number().int().min(0).optional().describe("Maximum age of sessions to keep (in days). Sessions older than this will be deleted. Defaults to 30."),
});

export type CleanupSessionsInput = z.infer<typeof CleanupSessionsInputSchema>;

/**
 * Empty input schema for tools that take no parameters.
 */
export const EmptyInputSchema = z.object({});

export type EmptyInput = z.infer<typeof EmptyInputSchema>;
