import { z } from "zod";

/** The test cases `muggle e2e-plan` reads from stdin, in the order the run will execute them. */
export const E2ePlanSchema = z
  .array(
    z.object({
      testCaseId: z.string().min(1),
      title: z.string().min(1),
    }),
  )
  .min(1);

/** A validated `muggle e2e-plan` stdin payload. */
export type E2ePlan = z.infer<typeof E2ePlanSchema>;

/** `muggle e2e-plan` flags. */
export interface E2ePlanFlags {
  /** The PR to post to; resolved from the branch checked out in `cwd` when absent. */
  pr?: string;
  /** The working tree under test; the current directory when absent. */
  cwd?: string;
}
