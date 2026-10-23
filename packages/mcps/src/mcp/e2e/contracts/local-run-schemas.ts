import { z } from "zod";

import { DisplayParamsSchema } from "../../contracts/display-params-schema.js";
import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import { PinnedAccountSchema } from "../../contracts/pinned-account-schema.js";
import { RunEnvironmentInputSchema } from "./run-environment.js";

/**
 * Local execution context schema for local-run upload.
 */
export const LocalExecutionContextInputSchema = z.object({
  originalUrl: z.string().url().describe("Original local URL used during local execution (typically localhost)"),
  productionUrl: z.string().url().describe("Cloud production URL for the test case"),
  runByUserId: z.string().min(1).describe("User ID who executed the run locally"),
  machineHostname: z.string().optional().describe("Local machine hostname"),
  osInfo: z.string().optional().describe("Local OS information"),
  electronAppVersion: z.string().optional().describe("Electron app version used for local run"),
  mcpServerVersion: z.string().optional().describe("MCP server version used for local run"),
  localExecutionCompletedAt: z.number().int().positive().describe("Epoch milliseconds when local run completed"),
  uploadedAt: z.number().int().positive().describe("Epoch milliseconds when uploaded to cloud"),
});

/**
 * Input schema for remote local-run upload tool.
 */
export const LocalRunUploadInputSchema = z.object({
  projectId: MuggleEntityIdSchema.describe("Project ID (UUID) for the local run"),
  useCaseId: MuggleEntityIdSchema.describe("Use case ID (UUID) for the local run"),
  testCaseId: MuggleEntityIdSchema.describe("Test case ID (UUID) for the local run"),
  runType: z.enum(["generation", "replay"]).describe("Type of local run to upload"),
  runEnvironmentType: RunEnvironmentInputSchema,
  productionUrl: z.string().url().describe("Cloud production URL associated with the run"),
  localExecutionContext: LocalExecutionContextInputSchema.describe("Local execution metadata"),
  actionScript: z.array(z.unknown()).min(1).describe("Generated action script steps from local execution"),
  status: z.enum(["passed", "failed"]).describe("Final local run status"),
  executionTimeMs: z.number().int().nonnegative().describe("Run duration in milliseconds"),
  errorMessage: z.string().optional().describe("Error message when status is failed"),
  pinnedAccount: PinnedAccountSchema.optional().describe(
    "The pinned account the run signed in as, copied from the run's actionParams. Omit when the run was not pinned",
  ),
  freshSession: z.boolean().optional().describe(
    "True when the run started from an emptied browser session, copied from the run's actionParams. Omit otherwise",
  ),
  runSettingsId: z.string().optional().describe(
    "runSettings record the run executed under, copied from the run's actionParams. Omit when it named none",
  ),
  displayParams: DisplayParamsSchema.optional().describe(
    "Window size the run executed at, copied from the run's actionParams",
  ),
});
