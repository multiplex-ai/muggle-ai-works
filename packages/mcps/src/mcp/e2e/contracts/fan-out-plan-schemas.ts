import { z } from "zod";

import { FanOutChoiceInputSchema } from "./fan-out-choice.js";
import { RunEnvironmentSchema } from "./run-environment.js";

/**
 * Input schema for muggle-remote-fan-out-plan. Ids are plain strings, as on muggle-remote-run-settings-list:
 * the backend validates them.
 */
export const FanOutPlanInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  testCaseId: z.string().min(1).describe("Test case ID whose fan-out to plan"),
  runEnvironmentType: RunEnvironmentSchema.describe(
    "Lane to plan: 'local' (developer localhost) or 'remote' (deployed). A record belongs to one lane.",
  ),
  fanOutChoice: FanOutChoiceInputSchema,
});
