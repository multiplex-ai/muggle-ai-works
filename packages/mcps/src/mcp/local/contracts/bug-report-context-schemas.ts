import { z } from "zod";

/** Input for muggle-local-bug-report-context-get. */
export const BugReportContextGetInputSchema = z.object({
  cwd: z
    .string()
    .min(1)
    .describe("Project root directory whose last-used Muggle Test project the context names."),
});

export type BugReportContextGetInput = z.infer<typeof BugReportContextGetInputSchema>;
