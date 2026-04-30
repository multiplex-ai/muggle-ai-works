/**
 * Zod schemas for last-project cache MCP tools.
 */

import { z } from "zod";

/** Input for muggle-local-last-project-get. */
export const LastProjectGetInputSchema = z.object({
  cwd: z
    .string()
    .describe("Project root directory whose last-used project to return."),
});

export type LastProjectGetInput = z.infer<typeof LastProjectGetInputSchema>;

/** Input for muggle-local-last-project-set. */
export const LastProjectSetInputSchema = z.object({
  cwd: z
    .string()
    .describe("Project root directory to save the cached project to."),
  projectId: z.string().min(1).describe("Muggle project ID."),
  projectUrl: z.string().min(1).describe("Muggle project URL."),
  projectName: z.string().min(1).describe("Muggle project name."),
});

export type LastProjectSetInput = z.infer<typeof LastProjectSetInputSchema>;

/** Input for muggle-local-last-project-clear. */
export const LastProjectClearInputSchema = z.object({
  cwd: z
    .string()
    .describe("Project root directory whose last-used project cache to remove."),
});

export type LastProjectClearInput = z.infer<typeof LastProjectClearInputSchema>;
