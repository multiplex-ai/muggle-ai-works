import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INTERNAL_DIAGNOSTICS_ENV_VAR } from "../../watchdog/constants.js";
import { internalDiagnosticsEnabled } from "../../watchdog/diagnostics.js";

describe("internalDiagnosticsEnabled", () => {
  let savedValue: string | undefined;

  beforeEach(() => {
    savedValue = process.env[INTERNAL_DIAGNOSTICS_ENV_VAR];
    delete process.env[INTERNAL_DIAGNOSTICS_ENV_VAR];
  });

  afterEach(() => {
    if (savedValue === undefined) delete process.env[INTERNAL_DIAGNOSTICS_ENV_VAR];
    else process.env[INTERNAL_DIAGNOSTICS_ENV_VAR] = savedValue;
  });

  it("is off by default so an end user's watcher writes no diagnostics", () => {
    expect(internalDiagnosticsEnabled()).toBe(false);
  });

  it("is on only for the exact opt-in value \"1\"", () => {
    process.env[INTERNAL_DIAGNOSTICS_ENV_VAR] = "1";
    expect(internalDiagnosticsEnabled()).toBe(true);
  });

  it("treats any other value as off — no accidental truthy enablement", () => {
    for (const value of ["0", "true", "yes", "", " 1"]) {
      process.env[INTERNAL_DIAGNOSTICS_ENV_VAR] = value;
      expect(internalDiagnosticsEnabled()).toBe(false);
    }
  });
});
