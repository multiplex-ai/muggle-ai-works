import { TelemetryEnvironment } from "@muggleai/telemetry";

import { RuntimeTarget } from "../../packages/mcps/src/index.js";

/** Telemetry environment stamped on client events, keyed by the prompt-service target the client talks to. */
export const TELEMETRY_ENVIRONMENT_BY_RUNTIME_TARGET: Record<RuntimeTarget, TelemetryEnvironment> = {
  [RuntimeTarget.Production]: TelemetryEnvironment.Production,
  [RuntimeTarget.Staging]: TelemetryEnvironment.Staging,
  [RuntimeTarget.Dev]: TelemetryEnvironment.Development,
};
