/**
 * Zod schemas for the remote taste profile MCP tools.
 */

import { z } from "zod";

/** Input for muggle-remote-taste-profile-upload. */
export const TasteProfileUploadInputSchema = z.object({
  hasUserApprovedThisUpload: z
    .boolean()
    .optional()
    .describe(
      "True only after the user approved this upload in the tasteProfileUpload picker. Needed when the preference is 'ask'; ignored under 'always'; never overrides 'never'.",
    ),
});

/** Input for muggle-remote-taste-profile-get. */
export const TasteProfileGetInputSchema = z.object({
  projectId: z
    .string()
    .min(1)
    .optional()
    .describe("Return the user-wide section plus this project's section; omit for the whole profile."),
});

/** Input for muggle-remote-taste-profile-delete. */
export const TasteProfileDeleteInputSchema = z.object({
  projectId: z
    .string()
    .min(1)
    .optional()
    .describe("Delete only this project's section; omit to delete the whole uploaded profile."),
});
