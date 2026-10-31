import { z } from "zod";

import { DisplayResolution } from "../../local/types/enums.js";

import { RunEnvironmentSchema } from "./run-environment.js";

/**
 * A project's resolutions, sent as the project's `displayOptions`. The backend makes the list the
 * resolution default of both lanes, so every test case that does not pick its own is verified at each.
 */
export const ProjectDisplayResolutionsInputSchema = z
  .array(z.nativeEnum(DisplayResolution))
  .min(1)
  .describe(
    "Resolutions every test case in the project is generated and run at, one run each, first one primary, e.g. [\"R_1920x1080\", \"R_0390x0844\"]. Applies to both lanes; a test case that picks its own keeps them. Saving a changed list adds a record for each new resolution and retires dropped ones. Omit to leave them unchanged.",
  );

/** Input schema for muggle-remote-project-display-resolutions-get. */
export const ProjectDisplayResolutionsGetInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  runEnvironmentType: RunEnvironmentSchema.optional().describe(
    "Lane to read: 'remote' (cloud runs, the default) or 'local' (developer localhost).",
  ),
});
