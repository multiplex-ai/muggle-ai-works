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
