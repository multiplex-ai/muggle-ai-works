/**
 * Constants for the first-run telemetry disclosure.
 */

/** Where the upstream copy's opt-out instruction begins. */
export const DISCLOSURE_OPT_OUT_MARKER = "To opt out,";

/**
 * Opt-out instruction naming mechanisms this CLI implements.
 *
 * Both are resolved by `@muggleai/telemetry`: the env var short-circuits, and
 * `telemetryEnabled` is read from the top level of the preferences file — a
 * sibling of `preferences`, not one of its keys.
 */
export const DISCLOSURE_OPT_OUT_COPY =
  'To opt out, set MUGGLE_TELEMETRY_DISABLED=1 in your environment, or set "telemetryEnabled": false at the top level of ~/.muggle-ai/preferences.json.';
