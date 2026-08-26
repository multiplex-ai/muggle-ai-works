import { afterEach, describe, expect, it } from "vitest";

import { getConfig, resetConfig } from "../shared/config.js";
import { RUNTIME_TARGET_ENV_VAR } from "../shared/runtime-target-constants.js";

afterEach(() => {
  delete process.env[RUNTIME_TARGET_ENV_VAR];
  resetConfig();
});

/**
 * Resolve the OAuth session file path under a given runtime target.
 * @param runtimeTarget - Target to resolve under.
 * @returns The resolved OAuth session file path.
 */
function resolveSessionPathForTarget(runtimeTarget: string): string {
  process.env[RUNTIME_TARGET_ENV_VAR] = runtimeTarget;
  resetConfig();
  return getConfig().localQa.oauthSessionFilePath;
}

describe("OAuth session file", () => {
  it("keeps the bare name on production so an existing login survives the upgrade", () => {
    expect(resolveSessionPathForTarget("production").endsWith("oauth-session.json")).toBe(true);
  });

  it("gives staging its own file", () => {
    expect(resolveSessionPathForTarget("staging").endsWith("oauth-session-staging.json")).toBe(
      true,
    );
  });

  it("gives dev its own file", () => {
    expect(resolveSessionPathForTarget("dev").endsWith("oauth-session-dev.json")).toBe(true);
  });

  // Tokens are tenant-specific, so a shared file let a login on either ring
  // destroy the other ring's session, and made status report whichever token
  // was written last as the active one no matter which ring was running.
  it("gives production and staging different files", () => {
    expect(resolveSessionPathForTarget("production")).not.toBe(
      resolveSessionPathForTarget("staging"),
    );
  });
});
