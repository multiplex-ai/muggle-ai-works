/**
 * Resolve the first-run telemetry disclosure shown by `muggle serve`.
 */

import { getDisclosureCopy } from "@muggleai/telemetry";

import { DISCLOSURE_OPT_OUT_COPY, DISCLOSURE_OPT_OUT_MARKER } from "./disclosure-constants.js";

/**
 * Build the disclosure text.
 *
 * What is collected stays upstream so the description cannot drift from what the
 * client actually sends. Only the closing instruction is replaced: upstream points
 * at `muggle preferences set telemetryEnabled false`, a command this CLI has never
 * registered, which left users with no working way to act on the notice.
 *
 * @returns Disclosure copy whose opt-out instructions both work.
 */
export function resolveDisclosureCopy(): string {
  const upstream = getDisclosureCopy();
  const markerIndex = upstream.indexOf(DISCLOSURE_OPT_OUT_MARKER);

  if (markerIndex < 0) {
    return `${upstream} ${DISCLOSURE_OPT_OUT_COPY}`;
  }

  return `${upstream.slice(0, markerIndex)}${DISCLOSURE_OPT_OUT_COPY}`;
}
