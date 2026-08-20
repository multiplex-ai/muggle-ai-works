import { afterEach, describe, expect, it } from "vitest";

import { getElectronAppDir, resetConfig } from "../shared/config.js";
import { RUNTIME_TARGET_ENV_VAR } from "../shared/runtime-target-constants.js";

afterEach(() => {
  delete process.env[RUNTIME_TARGET_ENV_VAR];
  resetConfig();
});

/**
 * Resolve the install directory under a given runtime target.
 * @param runtimeTarget - Target to resolve under.
 * @returns The resolved install directory path.
 */
function resolveDirForTarget(runtimeTarget: string): string {
  process.env[RUNTIME_TARGET_ENV_VAR] = runtimeTarget;
  resetConfig();
  return getElectronAppDir("1.9.0");
}

describe("electron-app install directory", () => {
  it("keeps the bare version on the production stream", () => {
    expect(resolveDirForTarget("production").endsWith("1.9.0")).toBe(true);
  });

  it("keeps the bare version for dev, which shares the production studio", () => {
    expect(resolveDirForTarget("dev").endsWith("1.9.0")).toBe(true);
  });

  it("suffixes the staging stream so it cannot occupy the production directory", () => {
    expect(resolveDirForTarget("staging").endsWith("1.9.0-staging")).toBe(true);
  });

  // The two streams publish the same version on purpose, so the version alone
  // does not identify a binary. Sharing a directory made an existing production
  // install look like a satisfied staging install: setup skipped the download
  // and ran the production studio against the staging backend, with no checksum
  // check because verification only happens while downloading.
  it("gives production and staging different directories at the same version", () => {
    const productionDir = resolveDirForTarget("production");
    const stagingDir = resolveDirForTarget("staging");

    expect(productionDir).not.toBe(stagingDir);
  });
});
