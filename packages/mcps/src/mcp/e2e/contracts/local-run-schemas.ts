import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";

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
  uploadedAt: z.number().int().positive().optional().describe("Epoch milliseconds when uploaded to cloud"),
});

/**
 * Input schema for remote local-run upload tool.
 */
export const LocalRunUploadInputSchema = z.object({
  projectId: MuggleEntityIdSchema.describe("Project ID (UUID) for the local run"),
  useCaseId: MuggleEntityIdSchema.describe("Use case ID (UUID) for the local run"),
  testCaseId: MuggleEntityIdSchema.describe("Test case ID (UUID) for the local run"),
  runType: z.enum(["generation", "replay"]).describe("Type of local run to upload"),
  productionUrl: z.string().url().describe("Cloud production URL associated with the run"),
  localExecutionContext: LocalExecutionContextInputSchema.describe("Local execution metadata"),
  actionScript: z.array(z.unknown()).min(1).describe("Generated action script steps from local execution"),
  status: z.enum(["passed", "failed"]).describe("Final local run status"),
  executionTimeMs: z.number().int().nonnegative().describe("Run duration in milliseconds"),
  errorMessage: z.string().optional().describe("Error message when status is failed"),
});
