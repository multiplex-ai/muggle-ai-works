import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import { DisplayResolution } from "../../local/types/enums.js";

import { RunEnvironmentSchema } from "./run-environment.js";
import { RunStrategy } from "./run-strategy-types.js";

/**
 * Resolution fields of muggle-remote-project-create and -update. The backend saves the resolutions as
 * the project's ordered `displayOptions` (primary first) and the run strategy as its `fanOutPolicy`,
 * on both lanes; a test case that picks its own resolutions keeps them.
 */
export const ProjectResolutionSettingsInputSchema = z.object({
  primaryResolution: z
    .nativeEnum(DisplayResolution)
    .optional()
    .describe(
      "Primary resolution: the viewport every test case in the project is generated and run at first, e.g. \"R_1920x1080\". Passed without compatibleResolutions, it also clears the compatible resolutions. Omit both to keep the current resolutions; a new project defaults to R_1920x1080 alone.",
    ),
  compatibleResolutions: z
    .array(z.nativeEnum(DisplayResolution))
    .optional()
    .describe(
      "Compatible resolutions: further viewports every test case also runs at, one run each, as runStrategy says, e.g. [\"R_0390x0844\"]. Replaces the whole list; [] clears it. Requires primaryResolution (read the current one with muggle-remote-project-display-resolutions-get) and must not include it; duplicates are dropped.",
    ),
  runStrategy: z
    .nativeEnum(RunStrategy)
    .optional()
    .describe(
      "Run strategy across the resolutions: primaryOnly runs the primary alone and reports the compatible resolutions as not run; primaryFirst runs the compatible resolutions only after the primary passes; allAtOnce runs every resolution at once. Omit to keep the current one; a project that never set one runs primaryOnly.",
    ),
});

/** Input schema for muggle-remote-project-display-resolutions-get. */
export const ProjectDisplayResolutionsGetInputSchema = z.object({
  projectId: MuggleEntityIdSchema.describe("Project ID (UUID)"),
  runEnvironmentType: RunEnvironmentSchema.optional().describe(
    "Lane to read: 'remote' (cloud runs, the default) or 'local' (developer localhost).",
  ),
});
