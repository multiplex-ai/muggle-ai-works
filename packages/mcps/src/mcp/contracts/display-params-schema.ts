import { z } from "zod";

/**
 * The browser window size a run executes at, in the shape cloud test scripts and runSettings
 * records store it. Kept free of per-field descriptions: it sits inside tool inputs that Codex
 * compacts past 5,000 bytes.
 */
export const DisplayParamsSchema = z.object({
  browserWindowWidth: z.number(),
  browserWindowHeight: z.number(),
});
