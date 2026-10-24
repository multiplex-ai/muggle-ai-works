import { z } from "zod";

import { RunEnvironmentSchema } from "./run-environment.js";

/**
 * Input schema for muggle-remote-run-settings-list. Ids are plain strings: the backend validates
 * them, and the schema stays far inside the size Codex compacts at.
 */
export const RunSettingsListInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  testCaseId: z.string().min(1).describe("Test case ID whose runSettings records to list"),
  runEnvironmentType: RunEnvironmentSchema.describe(
    "Lane whose records to list: 'local' (developer localhost) or 'remote' (deployed). A record belongs to one lane.",
  ),
});
