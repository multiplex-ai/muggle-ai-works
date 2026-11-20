import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import { ReportGenerationTypeEnum } from "./report-generation-types.js";

const ReportGenerationWorkflowIdSchema = MuggleEntityIdSchema.describe("Report generation workflow ID (UUID)");

/** Input of muggle-remote-report-generation-list; projectId is required so the list stays scoped to one project. */
export const ReportGenerationListInputSchema = z.object({
  projectId: MuggleEntityIdSchema.describe("Project ID (UUID) whose report generation workflows to list"),
  reportType: z.enum(ReportGenerationTypeEnum).optional().describe("Only list workflows of this report type"),
});

/** Input of muggle-remote-report-generation-get. */
export const ReportGenerationGetInputSchema = z.object({
  workflowId: ReportGenerationWorkflowIdSchema,
});

/** Input of muggle-remote-report-generation-update; at least one field is required and the project never changes. */
export const ReportGenerationUpdateInputSchema = z
  .object({
    workflowId: ReportGenerationWorkflowIdSchema,
    name: z.string().min(1).optional().describe("New workflow name"),
    description: z.string().min(1).optional().describe("New workflow description"),
    reportType: z.enum(ReportGenerationTypeEnum).optional().describe("Kind of report the workflow produces"),
  })
  .strict()
  .refine(
    (reportGenerationUpdate) =>
      reportGenerationUpdate.name !== undefined ||
      reportGenerationUpdate.description !== undefined ||
      reportGenerationUpdate.reportType !== undefined,
    { message: "Pass at least one of name, description or reportType" },
  );
