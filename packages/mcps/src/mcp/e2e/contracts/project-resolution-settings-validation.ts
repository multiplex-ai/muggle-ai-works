import type { z } from "zod";

import type { ProjectResolutionSettingsInputSchema } from "./project-display-resolution-schemas.js";

/**
 * Rejects resolution fields the backend's single ordered list cannot represent: compatible resolutions
 * without the primary they follow, and a compatible list that repeats the primary.
 * @param settings - The parsed resolution fields of a project create or update.
 * @param refinementContext - Zod context the issues are added to.
 */
export function addProjectResolutionSettingsIssues(
  settings: z.infer<typeof ProjectResolutionSettingsInputSchema>,
  refinementContext: z.RefinementCtx,
): void {
  if (settings.compatibleResolutions === undefined) {
    return;
  }
  if (settings.primaryResolution === undefined) {
    refinementContext.addIssue({
      code: "custom",
      path: ["compatibleResolutions"],
      message:
        "compatibleResolutions requires primaryResolution: the project's resolutions are saved as one list, primary first. Pass the current primary (read it with muggle-remote-project-display-resolutions-get) or a new one.",
    });
    return;
  }
  if (settings.compatibleResolutions.includes(settings.primaryResolution)) {
    refinementContext.addIssue({
      code: "custom",
      path: ["compatibleResolutions"],
      message: `compatibleResolutions must not include the primary resolution ${settings.primaryResolution}; it already runs as the primary.`,
    });
  }
}
