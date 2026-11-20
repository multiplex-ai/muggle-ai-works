import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import { ProjectLaneInputSchema } from "./run-environment.js";
import { ManagedProfileFieldEnum } from "./run-settings-write-types.js";

const RunSettingsProjectIdSchema = MuggleEntityIdSchema.describe("Project ID (UUID)");
const RequestingWorkflowRunIdSchema = MuggleEntityIdSchema.optional().describe(
  "Workflow run ID (UUID) that asked for the change; that run's pinned run settings move to the new version",
);

/** Input of muggle-remote-run-settings-bump; at least one of the run settings fields is required. */
export const RunSettingsBumpInputSchema = z
  .object({
    projectId: RunSettingsProjectIdSchema,
    runEnvironmentType: ProjectLaneInputSchema,
    managedProfile: z
      .partialRecord(z.enum(ManagedProfileFieldEnum), MuggleEntityIdSchema)
      .optional()
      .describe(
        "Managed profile field → secret ID (UUID) holding its value, e.g. { \"managed_profile_password\": \"<secretId>\" }. Omitted fields keep their current secret.",
      ),
    userSecrets: z
      .array(MuggleEntityIdSchema)
      .optional()
      .describe("Secret IDs (UUID) runs on the lane may use. Replaces the whole list."),
    workflowFiles: z
      .array(z.string().min(1))
      .optional()
      .describe("Workflow file IDs runs on the lane may use. Replaces the whole list."),
  })
  .refine(
    (bumpRequest) =>
      bumpRequest.managedProfile !== undefined ||
      bumpRequest.userSecrets !== undefined ||
      bumpRequest.workflowFiles !== undefined,
    { message: "Pass at least one of managedProfile, userSecrets or workflowFiles" },
  );

/** Input of muggle-remote-managed-profile-regenerate. */
export const ManagedProfileRegenerateInputSchema = z.object({
  projectId: RunSettingsProjectIdSchema,
  runEnvironmentType: ProjectLaneInputSchema,
  workflowRunId: RequestingWorkflowRunIdSchema,
});

/** Input of muggle-remote-managed-profile-field-set. */
export const ManagedProfileFieldSetInputSchema = z.object({
  projectId: RunSettingsProjectIdSchema,
  runEnvironmentType: ProjectLaneInputSchema,
  baseProjectResourcesId: MuggleEntityIdSchema.describe(
    "ID (UUID) of the run settings version to add the field onto, usually the one the run executes under",
  ),
  fieldName: z.enum(ManagedProfileFieldEnum).describe("Managed profile field to set"),
  secretId: MuggleEntityIdSchema.describe("Secret ID (UUID) holding the field's value"),
  workflowRunId: RequestingWorkflowRunIdSchema,
});
