import { afterEach, describe, expect, it, vi } from "vitest";

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
  it("passes for every shipped target", () => {
    for (const target of Object.values(RuntimeTarget)) {
      expect(() => assertDeviceCodeClientProvisioned(target)).not.toThrow();
    }
  });

  // Asserted against a stubbed profile rather than a real target: every shipped
  // target now has a client, and pinning this to whichever one happened to lack
  // it made provisioning that tenant fail the suite.
  it("rejects a target whose Auth0 client is not provisioned, naming the target", async () => {
    // resetModules first: runtime-target.js is already cached from this file's
    // top-level import, so without it the dynamic import below returns the
    // unmocked copy and the guard never sees the stubbed profile.
    vi.resetModules();
    vi.doMock("../shared/runtime-target-constants.js", async (importOriginal) => {
      const actual = await importOriginal<
        typeof import("../shared/runtime-target-constants.js")
      >();
      const realProfiles = actual.getRuntimeTargetProfiles();
      return {
        ...actual,
        getRuntimeTargetProfiles: () => ({
          ...realProfiles,
          [RuntimeTarget.Staging]: {
            ...realProfiles[RuntimeTarget.Staging],
            auth0ClientId: "",
          },
        }),
      };
    });

    const { assertDeviceCodeClientProvisioned: assertWithStub } = await import(
      "../shared/runtime-target.js"
    );

    expect(() => assertWithStub(RuntimeTarget.Staging)).toThrow(/staging/);
    expect(() => assertWithStub(RuntimeTarget.Staging)).toThrow(/no Auth0 device code client/);

    vi.doUnmock("../shared/runtime-target-constants.js");
    vi.resetModules();
  });
});
