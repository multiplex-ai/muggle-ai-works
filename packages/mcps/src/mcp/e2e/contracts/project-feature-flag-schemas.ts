import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import { ProjectLaneInputSchema } from "./run-environment.js";

const FeatureFlagProjectIdSchema = MuggleEntityIdSchema.describe("Project ID (UUID)");
const FeatureFlagValuesSchema = z.array(z.string().min(1));

/** Input of muggle-remote-project-feature-flags-get. */
export const ProjectFeatureFlagsGetInputSchema = z.object({
  projectId: FeatureFlagProjectIdSchema,
  runEnvironmentType: ProjectLaneInputSchema,
});

/** Input of muggle-remote-project-feature-flags-update; at least one of the flag fields is required. */
export const ProjectFeatureFlagsUpdateInputSchema = z
  .object({
    projectId: FeatureFlagProjectIdSchema,
    runEnvironmentType: ProjectLaneInputSchema,
    enabledValues: FeatureFlagValuesSchema.optional().describe(
      "Every feature flag a test case on the lane may run with, e.g. [\"newCheckout\", \"darkMode\"]. Replaces the whole list.",
    ),
    defaultValues: FeatureFlagValuesSchema.optional().describe(
      "Flags a test case that picks none of its own runs with; each must be in enabledValues. Replaces the whole list; [] runs with no flags.",
    ),
    valueGroups: z
      .record(z.string().min(1), FeatureFlagValuesSchema)
      .optional()
      .describe(
        "Named flag sets a test case can pick by name, e.g. { \"beta\": [\"newCheckout\", \"darkMode\"] }; every member must be in enabledValues. Replaces every group; {} removes them all.",
      ),
  })
  .refine(
    (featureFlagsUpdate) =>
      featureFlagsUpdate.enabledValues !== undefined ||
      featureFlagsUpdate.defaultValues !== undefined ||
      featureFlagsUpdate.valueGroups !== undefined,
    { message: "Pass at least one of enabledValues, defaultValues or valueGroups" },
  );
