import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import { DisplayResolution } from "../../local/types/enums.js";

import { RunEnvironmentSchema } from "./run-environment.js";
import { RunStrategy } from "./run-strategy-types.js";

/** Input schema for muggle-remote-test-case-display-resolutions-get. */
export const TestCaseDisplayResolutionsGetInputSchema = z.object({
  projectId: MuggleEntityIdSchema.describe("Project ID (UUID)"),
  testCaseId: MuggleEntityIdSchema.describe("Test case ID (UUID)"),
  runEnvironmentType: RunEnvironmentSchema.optional().describe(
    "Lane: 'remote' (cloud runs, the default) or 'local' (developer localhost).",
  ),
});

/** One feature-flag variant of a test spec: a raw flag set, or the name of a value group in the project test spec. */
export const TestSpecFeatureFlagVariantSchema = z.union([
  z.array(z.string()),
  z.object({ groupName: z.string().min(1) }),
]);

/** Input schema for muggle-remote-test-case-display-resolutions-update. */
export const TestCaseDisplayResolutionsUpdateInputSchema = TestCaseDisplayResolutionsGetInputSchema.extend({
  displayResolutions: z
    .array(z.nativeEnum(DisplayResolution))
    .min(1)
    .describe(
      "Resolutions the test case is verified at on this lane, one run each, e.g. [\"R_0390x0844\"]. Replaces the whole list; duplicates are dropped. The current primary stays primary while it is listed; otherwise the first listed becomes primary. Each must be enabled on the project lane (see enabledResolutions from muggle-remote-project-display-resolutions-get).",
    ),
  featureFlags: z
    .array(TestSpecFeatureFlagVariantSchema)
    .optional()
    .describe(
      "Feature-flag variants to keep, passed back verbatim from featureFlags of muggle-remote-test-case-display-resolutions-get. Omit to put the test case on the lane's default flags.",
    ),
  runStrategy: z
    .nativeEnum(RunStrategy)
    .nullable()
    .optional()
    .describe(
      "Run strategy across the test case's resolutions: primaryOnly, primaryFirst or allAtOnce. null returns the test case to the project lane's strategy; omit to keep the current one.",
    ),
});
