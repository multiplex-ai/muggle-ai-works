import { afterEach, describe, expect, it } from "vitest";

import { RUNTIME_TARGET_ENV_VAR } from "../shared/runtime-target-constants.js";
import {
  assertDeviceCodeClientProvisioned,
  resolveActiveProfile,
  resolveRuntimeTarget,
} from "../shared/runtime-target.js";
import { RuntimeTarget } from "../shared/runtime-target-types.js";

afterEach(() => {
  delete process.env[RUNTIME_TARGET_ENV_VAR];
});

describe("resolveRuntimeTarget", () => {
  it("prefers the environment override over the baked default", () => {
    process.env[RUNTIME_TARGET_ENV_VAR] = "staging";
    expect(resolveRuntimeTarget(RuntimeTarget.Production)).toBe(RuntimeTarget.Staging);
  });

  it("falls back to the baked default when no override is set", () => {
    expect(resolveRuntimeTarget(RuntimeTarget.Production)).toBe(RuntimeTarget.Production);
  });

  it("falls back to dev when neither override nor baked default is set", () => {
    expect(resolveRuntimeTarget(undefined)).toBe(RuntimeTarget.Dev);
  });

  it("rejects an unknown target by name, listing the valid ones", () => {
    process.env[RUNTIME_TARGET_ENV_VAR] = "prodction";
    expect(() => resolveRuntimeTarget(RuntimeTarget.Production)).toThrow(/prodction/);
    expect(() => resolveRuntimeTarget(RuntimeTarget.Production)).toThrow(/production, staging, dev/);
  });
});

describe("resolveActiveProfile", () => {
  it("returns the profile for the resolved target", () => {
    process.env[RUNTIME_TARGET_ENV_VAR] = "production";
    expect(resolveActiveProfile(RuntimeTarget.Dev).promptServiceBaseUrl).toBe(
      "https://promptservice.muggle-ai.com",
    );
  });

  it("resolves a target whose Auth0 client is not yet provisioned", () => {
    process.env[RUNTIME_TARGET_ENV_VAR] = "staging";
    expect(resolveActiveProfile(RuntimeTarget.Production).promptServiceBaseUrl).toBe(
      "https://staging.promptservice.muggle-ai.com",
    );
  });
});

describe("assertDeviceCodeClientProvisioned", () => {
  it("passes for a target with a provisioned client", () => {
    expect(() => assertDeviceCodeClientProvisioned(RuntimeTarget.Production)).not.toThrow();
  });

  it("rejects a target whose Auth0 client is not provisioned, naming the target", () => {
    expect(() => assertDeviceCodeClientProvisioned(RuntimeTarget.Staging)).toThrow(/staging/);
    expect(() => assertDeviceCodeClientProvisioned(RuntimeTarget.Staging)).toThrow(
      /no Auth0 device code client/,
    );
  });
});
