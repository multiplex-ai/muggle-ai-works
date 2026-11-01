/**
 * Translates a project's resolutions and run strategy between the MCP surface (a primary resolution,
 * compatible resolutions, a run strategy) and the backend's (one ordered `displayOptions` list, primary
 * first, and `fanOutPolicy`). Reads come from a lane's project test spec, which is what generation and
 * runs use; the project's own `displayOptions` is only the list last saved through a project create or
 * update, and on an older project may never have taken effect.
 */

import type { z } from "zod";

import type {
  ProjectDisplayResolutionsGetInputSchema,
  ProjectResolutionSettingsInputSchema,
} from "../../e2e/contracts/index.js";
import { RunEnvironment } from "../../e2e/contracts/run-environment.js";
import type { RunStrategy } from "../../e2e/contracts/run-strategy-types.js";
import { GatewayError, McpErrorCode, type IUpstreamResponse } from "../../e2e/types.js";
import type { DisplayResolution } from "../../local/types/enums.js";
import {
  DEFAULT_RUN_STRATEGY,
  KNOWN_DISPLAY_RESOLUTIONS,
  KNOWN_RUN_STRATEGIES,
} from "./project-display-resolutions-constants.js";
import type {
  IProjectDisplayResolutionsOutput,
  IProjectResolutionUpstreamFields,
  IRawProjectTestSpecEnvelope,
} from "./project-display-resolutions-transform-types.js";

/**
 * Builds the resolution fields of a project create or update body. A primary resolution sends the whole
 * list, primary first and deduplicated, so passing it alone clears the compatible resolutions; no
 * primary leaves the resolutions off the body. The run strategy travels as `fanOutPolicy`.
 *
 * Output shape: `{ displayOptions: ["R_1920x1080", "R_0390x0844"], fanOutPolicy: "primaryFirst" }`
 *
 * @param settings - Resolution fields already validated by the tool's input schema.
 */
export function toProjectResolutionUpstreamFields(
  settings: z.infer<typeof ProjectResolutionSettingsInputSchema>,
): IProjectResolutionUpstreamFields {
  const upstreamFields: IProjectResolutionUpstreamFields = {};
  if (settings.primaryResolution !== undefined) {
    upstreamFields.displayOptions = [
      ...new Set([settings.primaryResolution, ...(settings.compatibleResolutions ?? [])]),
    ];
  }
  if (settings.runStrategy !== undefined) {
    upstreamFields.fanOutPolicy = settings.runStrategy;
  }
  return upstreamFields;
}

/**
 * Maps a project lane's project test spec to its primary and compatible resolutions and run strategy.
 *
 * Output shape: `{ projectId: "…", runEnvironmentType: "remote", primaryResolution: "R_1920x1080", compatibleResolutions: ["R_0390x0844"], enabledResolutions: [...], runStrategy: "primaryOnly" }`
 *
 * @throws GatewayError when the body carries the lane's resolutions neither as `effectivePerAxis` nor, from an
 * older backend, on `projectTestSpec.perAxis`.
 */
export function mapProjectDisplayResolutions(
  response: IUpstreamResponse,
  input?: unknown,
): IProjectDisplayResolutionsOutput {
  const toolInput = input as z.infer<typeof ProjectDisplayResolutionsGetInputSchema>;
  const envelope = response.data as IRawProjectTestSpecEnvelope | null | undefined;
  // An older backend sends no effectivePerAxis; its saved spec is then the only source, and a lane never
  // edited has none, so the tool reports an error instead of guessing the platform default.
  const displayResolutionAxis =
    envelope?.effectivePerAxis?.displayResolution ?? envelope?.projectTestSpec?.perAxis?.displayResolution;
  if (!displayResolutionAxis) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message:
        "project test spec response carried no display resolutions: neither effectivePerAxis.displayResolution nor projectTestSpec.perAxis.displayResolution.",
      statusCode: response.statusCode,
    });
  }
  const runEnvironmentType = toolInput.runEnvironmentType ?? RunEnvironment.Remote;
  const runStrategy = toRunStrategy(envelope?.fanOutPolicy ?? envelope?.projectTestSpec?.fanOutPolicy);
  // Split before filtering, so a primary this MCP version does not know never promotes a compatible one.
  const [primaryOptionId, ...compatibleOptionIds] = displayResolutionAxis.default ?? [];
  return {
    projectId: toolInput.projectId,
    runEnvironmentType: runEnvironmentType,
    primaryResolution: isKnownDisplayResolution(primaryOptionId) ? primaryOptionId : null,
    compatibleResolutions: toKnownDisplayResolutions(compatibleOptionIds),
    enabledResolutions: toKnownDisplayResolutions(displayResolutionAxis.enabledValues),
    runStrategy: runStrategy,
  };
}

function isKnownDisplayResolution(optionId: string | undefined): optionId is DisplayResolution {
  return optionId !== undefined && KNOWN_DISPLAY_RESOLUTIONS.has(optionId);
}

function toKnownDisplayResolutions(optionIds: string[] | undefined): DisplayResolution[] {
  return (optionIds ?? []).filter(isKnownDisplayResolution);
}

function toRunStrategy(fanOutPolicy: string | undefined): RunStrategy {
  return fanOutPolicy !== undefined && KNOWN_RUN_STRATEGIES.has(fanOutPolicy)
    ? (fanOutPolicy as RunStrategy)
    : DEFAULT_RUN_STRATEGY;
}
