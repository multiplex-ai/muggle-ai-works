import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { initTelemetry } = vi.hoisted(() => ({ initTelemetry: vi.fn() }));
vi.mock("@muggleai/telemetry", () => ({ initTelemetry: initTelemetry }));

import { CONSOLE_FREE_RESOURCE_DETECTORS, RESOURCE_DETECTORS_ENV_VAR } from "../../client-telemetry/constants.js";
import { startClientTelemetry } from "../../client-telemetry/start-client-telemetry.js";

const initOptions = { serviceName: "muggle-mcp", surface: "mcp-local", connectionString: "" } as Parameters<
  typeof startClientTelemetry
>[0];

describe("startClientTelemetry", () => {
  let detectorsBefore: string | undefined;

  beforeEach(() => {
    detectorsBefore = process.env[RESOURCE_DETECTORS_ENV_VAR];
    delete process.env[RESOURCE_DETECTORS_ENV_VAR];
    initTelemetry.mockReset();
  });

  afterEach(() => {
    if (detectorsBefore === undefined) delete process.env[RESOURCE_DETECTORS_ENV_VAR];
    else process.env[RESOURCE_DETECTORS_ENV_VAR] = detectorsBefore;
  });

  it("selects only console-free resource detectors before the client starts", () => {
    initTelemetry.mockImplementation(() => {
      expect(process.env[RESOURCE_DETECTORS_ENV_VAR]).toBe(CONSOLE_FREE_RESOURCE_DETECTORS);
    });
    startClientTelemetry(initOptions);
    expect(initTelemetry).toHaveBeenCalledWith(initOptions);
  });

  it("leaves detectors the user chose explicitly alone", () => {
    process.env[RESOURCE_DETECTORS_ENV_VAR] = "env";
    startClientTelemetry(initOptions);
    expect(process.env[RESOURCE_DETECTORS_ENV_VAR]).toBe("env");
  });

  it("never lists the host detector, which shells out for the machine id", () => {
    expect(CONSOLE_FREE_RESOURCE_DETECTORS.split(",")).not.toContain("host");
  });
});
