/**
 * Reads the real package.json through the real getters. The setup and upgrade
 * suites stub these getters, so a field getMuggleConfig() drops only shows up here.
 */

import { readFileSync } from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getActiveElectronAppReleaseStream,
  getActiveRuntimeTarget,
  getBundledElectronAppVersion,
  getDownloadBaseUrl,
  getElectronAppChecksums,
  getElectronAppSignedFromVersion,
  getReleaseSignerIdentityUri,
  resetConfig,
} from "../../../packages/mcps/src/shared/config.js";
import { RUNTIME_TARGET_ENV_VAR } from "../../../packages/mcps/src/shared/runtime-target-constants.js";
import type { IMuggleConfig } from "../../../packages/mcps/src/shared/types.js";
import { resolveIntegrityPolicy } from "../../../scripts/release-integrity/index.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const packagedMuggleConfig = (
  JSON.parse(readFileSync(path.join(REPOSITORY_ROOT, "package.json"), "utf-8")) as { muggleConfig: Required<IMuggleConfig> }
).muggleConfig;

/** What each muggleConfig field reads back as through its getter, against what package.json holds. */
const readBackByField: Record<keyof IMuggleConfig, () => { actual: unknown; packaged: unknown }> = {
  electronAppVersion: () => ({
    actual: getBundledElectronAppVersion(),
    packaged: packagedMuggleConfig.electronAppVersion,
  }),
  downloadBaseUrl: () => ({
    actual: getDownloadBaseUrl(),
    packaged: packagedMuggleConfig.downloadBaseUrl,
  }),
  checksumsByStream: () => ({
    actual: getElectronAppChecksums(),
    packaged: packagedMuggleConfig.checksumsByStream[getActiveElectronAppReleaseStream()],
  }),
  runtimeTargetDefault: () => ({
    actual: getActiveRuntimeTarget(),
    packaged: packagedMuggleConfig.runtimeTargetDefault,
  }),
  electronAppSignedFromVersion: () => ({
    actual: getElectronAppSignedFromVersion(),
    packaged: packagedMuggleConfig.electronAppSignedFromVersion,
  }),
  signerIdentityUri: () => ({
    actual: getReleaseSignerIdentityUri(),
    packaged: packagedMuggleConfig.signerIdentityUri,
  }),
};

describe("muggleConfig read through the real getters", () => {
  beforeEach(() => {
    vi.stubEnv(RUNTIME_TARGET_ENV_VAR, "");
    resetConfig();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("has a read-back for every field package.json ships, so a new field cannot go unchecked", () => {
    expect(Object.keys(readBackByField).sort()).toEqual(Object.keys(packagedMuggleConfig).sort());
  });

  it.each(Object.keys(readBackByField) as Array<keyof IMuggleConfig>)("carries %s through", (field) => {
    const { actual, packaged } = readBackByField[field]();

    expect(packaged).toBeTruthy();
    expect(actual).toEqual(packaged);
  });

  it("makes the pinned studio version require a signature, as postinstall does", () => {
    const integrityPolicy = resolveIntegrityPolicy({
      version: getBundledElectronAppVersion(),
      signedFromVersion: getElectronAppSignedFromVersion(),
      expectedChecksum: "",
    });

    expect(integrityPolicy.requiresSignature).toBe(true);
    expect(integrityPolicy.unverifiableReason).toBe("");
  });
});
