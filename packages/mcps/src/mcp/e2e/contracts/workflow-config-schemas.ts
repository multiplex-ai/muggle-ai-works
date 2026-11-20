import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import { LLM_TIER_DISPLAY_LABELS, LLM_TIER_MODEL_NAMES } from "../../../shared/llm-tier-constants.js";
import { LlmTierEnum } from "../../../shared/llm-tier-types.js";
import { WORKFLOW_MAX_RUN_TIME_PARAMS_DESCRIPTION } from "../../../shared/workflow-max-run-time-constants.js";
import { WorkflowMaxRunTimeParamsSchema } from "./workflow-max-run-time-schemas.js";

const WorkflowConfigProjectIdSchema = MuggleEntityIdSchema.describe("Project ID (UUID) whose workflow config to use");

/** Input of muggle-remote-project-workflow-config-get and muggle-remote-project-workflow-config-delete. */
export const ProjectWorkflowConfigTargetInputSchema = z.object({
  projectId: WorkflowConfigProjectIdSchema,
});

/** Input of muggle-remote-project-workflow-config-update; at least one setting is required. */
export const ProjectWorkflowConfigUpdateInputSchema = z
  .object({
    projectId: WorkflowConfigProjectIdSchema,
    modelTier: z
      .enum(LlmTierEnum)
      .nullable()
      .optional()
      .describe(
        `Model tier the project's runs use: '${LlmTierEnum.Standard}' is the ${LLM_TIER_DISPLAY_LABELS[LlmTierEnum.Standard]} tier (${LLM_TIER_MODEL_NAMES[LlmTierEnum.Standard]}, the default); '${LlmTierEnum.Light}' is the ${LLM_TIER_DISPLAY_LABELS[LlmTierEnum.Light]} tier (${LLM_TIER_MODEL_NAMES[LlmTierEnum.Light]}, faster and lower cost). null clears the project's tier so its runs inherit the user-level one.`,
      ),
    enableSharedTestMemory: z.boolean().optional().describe("Enable or disable SharedTestMemory for the project's runs"),
    enableEverMemOS: z.boolean().optional().describe("Enable or disable EverMemOS for the project's runs"),
    maxRunTimeMs: WorkflowMaxRunTimeParamsSchema.optional().describe(WORKFLOW_MAX_RUN_TIME_PARAMS_DESCRIPTION),
  })
  .refine(
    (configUpdate) =>
      configUpdate.modelTier !== undefined ||
      configUpdate.enableSharedTestMemory !== undefined ||
      configUpdate.enableEverMemOS !== undefined ||
      configUpdate.maxRunTimeMs !== undefined,
    { message: "Pass at least one of modelTier, enableSharedTestMemory, enableEverMemOS or maxRunTimeMs" },
  );
