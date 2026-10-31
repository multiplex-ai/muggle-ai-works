/**
 * Reads a project lane's resolutions in effect out of its project test spec, which is what
 * generation and runs use. The project's own `displayOptions` is the list last saved through a
 * project create or update, and on an older project may never have taken effect.
 */

import type { z } from "zod";

import type { ProjectDisplayResolutionsGetInputSchema } from "../../e2e/contracts/index.js";
import { RunEnvironment } from "../../e2e/contracts/run-environment.js";
import { GatewayError, McpErrorCode, type IUpstreamResponse } from "../../e2e/types.js";
import { DisplayResolution } from "../../local/types/enums.js";
import type {
  IProjectDisplayResolutionsOutput,
  IRawProjectTestSpecEnvelope,
} from "./project-display-resolutions-transform-types.js";

/** The platform default a never-edited lane runs at; mirrors the backend's test axis config seed. */
const PLATFORM_DEFAULT_DISPLAY_RESOLUTIONS: DisplayResolution[] = [DisplayResolution.R_1920x1080];

const KNOWN_DISPLAY_RESOLUTIONS = new Set<string>(Object.values(DisplayResolution));

/**
 * Maps a project lane's project test spec to the resolutions in effect on it.
 *
 * Output shape: `{ projectId: "…", runEnvironmentType: "remote", displayResolutions: ["R_1920x1080", "R_0390x0844"], enabledResolutions: [...], isPlatformDefault: false }`
 *
 * @throws GatewayError when the upstream body is not a project test spec envelope.
 */
export function mapProjectDisplayResolutions(
  response: IUpstreamResponse,
  input?: unknown,
): IProjectDisplayResolutionsOutput {
  const toolInput = input as z.infer<typeof ProjectDisplayResolutionsGetInputSchema>;
  const envelope = response.data as IRawProjectTestSpecEnvelope | undefined;
  if (envelope === undefined || envelope === null || typeof envelope !== "object" || !("projectTestSpec" in envelope)) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message: "project test spec response carried no projectTestSpec field.",
      statusCode: response.statusCode,
    });
  }
  const runEnvironmentType = toolInput.runEnvironmentType ?? RunEnvironment.Remote;
  const displayResolutionAxis = envelope.projectTestSpec?.perAxis?.displayResolution;
  if (!displayResolutionAxis) {
    return {
      projectId: toolInput.projectId,
      runEnvironmentType: runEnvironmentType,
      displayResolutions: [...PLATFORM_DEFAULT_DISPLAY_RESOLUTIONS],
      enabledResolutions: Object.values(DisplayResolution),
      isPlatformDefault: true,
    };
  }
  return {
    projectId: toolInput.projectId,
    runEnvironmentType: runEnvironmentType,
    displayResolutions: toKnownDisplayResolutions(displayResolutionAxis.default),
    enabledResolutions: toKnownDisplayResolutions(displayResolutionAxis.enabledValues),
    isPlatformDefault: false,
  };
}

function toKnownDisplayResolutions(optionIds: string[] | undefined): DisplayResolution[] {
  return (optionIds ?? []).filter((optionId): optionId is DisplayResolution => KNOWN_DISPLAY_RESOLUTIONS.has(optionId));
}
