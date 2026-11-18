import { initTelemetry, type InitOptions } from "@muggleai/telemetry";

import { CONSOLE_FREE_RESOURCE_DETECTORS, RESOURCE_DETECTORS_ENV_VAR } from "./constants.js";

/**
 * Starts the shared telemetry client with only resource detectors that start no child process, unless the user chose
 * detectors explicitly. Every client telemetry start goes through here.
 * @param options - Passed through to `initTelemetry`.
 */
export function startClientTelemetry(options: InitOptions): void {
  process.env[RESOURCE_DETECTORS_ENV_VAR] ??= CONSOLE_FREE_RESOURCE_DETECTORS;
  initTelemetry(options);
}
