import type { z } from "zod";

import type { ProjectFeatureFlagsGetInputSchema } from "../../e2e/contracts/index.js";
import { RunEnvironment } from "../../e2e/contracts/run-environment.js";
import type { IUpstreamResponse } from "../../e2e/types.js";
import type { IRawProjectTestSpecEnvelope } from "./project-display-resolutions-transform-types.js";
import type { IProjectFeatureFlagsOutput } from "./project-feature-flags-transform-types.js";

/**
 * Maps a project lane's project test spec to its feature flags axis. A lane never edited, or a backend that
 * sends no axis, reports empty lists, which is the platform seed for feature flags.
 *
 * Output shape: `{ projectId: "…", runEnvironmentType: "remote", featureFlags: { enabledValues: ["beta"], defaultValues: [], valueGroups: { "all": ["beta"] } } }`
 *
 * @param response - Body of `GET /projects/:projectId/project-test-spec`.
 * @param input - Tool input already validated by its schema.
 */
export function mapProjectFeatureFlags(response: IUpstreamResponse, input?: unknown): IProjectFeatureFlagsOutput {
  const toolInput = input as z.infer<typeof ProjectFeatureFlagsGetInputSchema>;
  const envelope = response.data as IRawProjectTestSpecEnvelope | null | undefined;
  const featureFlagsAxis = envelope?.effectivePerAxis?.featureFlags ?? envelope?.projectTestSpec?.perAxis?.featureFlags;
  return {
    projectId: toolInput.projectId,
    runEnvironmentType: toolInput.runEnvironmentType ?? RunEnvironment.Remote,
    featureFlags: {
      enabledValues: featureFlagsAxis?.enabledValues ?? [],
      defaultValues: featureFlagsAxis?.default ?? [],
      valueGroups: featureFlagsAxis?.valueGroups ?? {},
    },
  };
}
