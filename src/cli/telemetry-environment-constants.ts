import { TelemetryEnvironment } from "@muggleai/telemetry";

import { RuntimeTarget } from "../../packages/mcps/src/index.js";

/**
 * The client telemetry connection string, inlined at publish time by tsup `define` from the env var of the same name
 * (a GitHub secret in the publish workflow). Empty in dev builds, which keeps client telemetry a no-op.
 */
export const APPLICATIONINSIGHTS_CONNECTION_STRING: string = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? "";

/** Telemetry environment stamped on client events, keyed by the prompt-service target the client talks to. */
export const TELEMETRY_ENVIRONMENT_BY_RUNTIME_TARGET: Record<RuntimeTarget, TelemetryEnvironment> = {
  [RuntimeTarget.Production]: TelemetryEnvironment.Production,
  [RuntimeTarget.Staging]: TelemetryEnvironment.Staging,
  [RuntimeTarget.Dev]: TelemetryEnvironment.Development,
};
