/**
 * Resolves the webview sizing a local run executes at.
 */

import {
  DEFAULT_DISPLAY_RESOLUTION,
  DISPLAY_PARAMS_BY_RESOLUTION,
} from "./display-resolution-constants.js";
import type { DisplayParams } from "../types/display-types.js";
import { DisplayResolution } from "../types/enums.js";

/**
 * Resolve the webview dimensions for a run.
 *
 * Precedence, highest first:
 * 1. `requestedResolution` — what the caller asked for on this run.
 * 2. `storedDisplayOptions[0]` — the resolution stamped on the cloud entity.
 * 3. {@link DEFAULT_DISPLAY_RESOLUTION}.
 *
 * This mirrors the cloud lane, where a run's resolved settings win over the
 * test case's stored option.
 *
 * @param params.requestedResolution - Resolution named by the caller, if any.
 * @param params.storedDisplayOptions - Resolutions stored on the entity, if any.
 * @returns Webview dimensions to hand the studio.
 *
 * Output shape: `{ browserWindowWidth: 390, browserWindowHeight: 844 }`
 */
export function resolveDisplayParams(params: {
  requestedResolution?: DisplayResolution;
  storedDisplayOptions?: DisplayResolution[];
}): DisplayParams {
  const storedResolution = params.storedDisplayOptions?.[0];
  const effectiveResolution =
    params.requestedResolution ?? storedResolution ?? DEFAULT_DISPLAY_RESOLUTION;

  // An unrecognised value reaching here (an entity stamped by a newer cloud
  // build) must not size the window to undefined — fall back rather than throw.
  return (
    DISPLAY_PARAMS_BY_RESOLUTION[effectiveResolution] ??
    DISPLAY_PARAMS_BY_RESOLUTION[DEFAULT_DISPLAY_RESOLUTION]
  );
}

/**
 * Resolve the webview dimensions a replay executes at: the caller's resolution,
 * else the size the script was recorded at, else
 * {@link DEFAULT_DISPLAY_RESOLUTION}.
 *
 * @param params.requestedResolution - Resolution named by the caller, if any.
 * @param params.recordedDisplayParams - Size the test script was recorded at, if it carries one.
 * @returns Webview dimensions to hand the studio.
 * @throws Error when the caller names a resolution other than the recorded size: that run would
 * replay one record's recording under another record's configuration.
 */
export function resolveReplayDisplayParams(params: {
  requestedResolution?: DisplayResolution;
  recordedDisplayParams?: DisplayParams;
}): DisplayParams {
  if (params.requestedResolution === undefined) {
    return params.recordedDisplayParams ?? DISPLAY_PARAMS_BY_RESOLUTION[DEFAULT_DISPLAY_RESOLUTION];
  }
  const requestedDisplayParams = resolveDisplayParams({ requestedResolution: params.requestedResolution });
  const recorded = params.recordedDisplayParams;
  if (
    recorded !== undefined &&
    (recorded.browserWindowWidth !== requestedDisplayParams.browserWindowWidth ||
      recorded.browserWindowHeight !== requestedDisplayParams.browserWindowHeight)
  ) {
    throw new Error(
      `This test script was recorded at ${recorded.browserWindowWidth}x${recorded.browserWindowHeight}; ` +
        `replaying it at ${params.requestedResolution} would not replay its own runSettings record. ` +
        `Replay it without displayResolution, or run test generation at ${params.requestedResolution} to record that resolution's script.`,
    );
  }
  return requestedDisplayParams;
}
