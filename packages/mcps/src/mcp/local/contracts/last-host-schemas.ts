/** Zod schemas for last-host cache MCP tools. */

import { z } from "zod";

export const LastHostGetInputSchema = z.object({
  cwd: z.string().describe("Project root directory whose last-used host to return."),
});

export type LastHostGetInput = z.infer<typeof LastHostGetInputSchema>;

export const LastHostSetInputSchema = z.object({
  cwd: z.string().describe("Project root directory to save the cached host to."),
  host: z.string().min(1).describe("Local dev server URL (e.g. http://localhost:3000)."),
});

export type LastHostSetInput = z.infer<typeof LastHostSetInputSchema>;

export const LastHostClearInputSchema = z.object({
  cwd: z.string().describe("Project root directory whose last-used host cache to remove."),
});

export type LastHostClearInput = z.infer<typeof LastHostClearInputSchema>;
