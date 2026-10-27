import { readFileSync } from "fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildElectronAppDirName as buildRuntimeDirName,
  parseElectronAppDirName,
} from "../../../packages/mcps/src/shared/electron-app-install-dir.js";
import { ElectronAppReleaseStream } from "../../../packages/mcps/src/shared/runtime-target-types.js";
import {
  buildElectronAppDirName as buildInstallerDirName,
  isOutdatedStreamInstall,
  isStreamInstall,
  shouldKeepVersionOverride,
} from "../../../scripts/electron-app-install-dir.mjs";

const runtimeTargets = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../../config/runtime-targets.json", import.meta.url)), "utf-8"),
) as { streams: Record<string, unknown> };

const postinstallSource = readFileSync(
  fileURLToPath(new URL("../../../scripts/postinstall.mjs", import.meta.url)),
  "utf-8",
);

describe("electron-app install directory", () => {
  it.each(Object.keys(runtimeTargets.streams))(
    "the postinstall installs the %s stream where the runtime looks for it",
    (releaseStream) => {
      expect(buildInstallerDirName({ version: "1.13.9", releaseStream: releaseStream })).toBe(
        buildRuntimeDirName({ version: "1.13.9", releaseStream: releaseStream as ElectronAppReleaseStream }),
      );
    },
  );

  it("keeps production in the bare version directory and suffixes staging", () => {
    expect(buildInstallerDirName({ version: "1.13.9", releaseStream: "production" })).toBe("1.13.9");
    expect(buildInstallerDirName({ version: "1.13.9", releaseStream: "staging" })).toBe("1.13.9-staging");
  });

  it("names the install directory from the stream, never from the version alone", () => {
    expect(postinstallSource).toContain("buildElectronAppDirName({ version: version, releaseStream: releaseStream })");
    expect(postinstallSource).not.toContain("join(appDir, version)");
  });
});

describe("isOutdatedStreamInstall", () => {
  const productionInstall = { releaseStream: "production", currentDirectoryName: "1.13.9" };
  const stagingInstall = { releaseStream: "staging", currentDirectoryName: "1.13.9-staging" };

  it("prunes the installing stream's older versions", () => {
    expect(isOutdatedStreamInstall({ ...productionInstall, directoryName: "1.10.6" })).toBe(true);
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.10.6-staging" })).toBe(true);
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.13.8-staging" })).toBe(true);
  });

  it("compares versions numerically, not as text", () => {
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.9.0-staging" })).toBe(true);
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.100.0-staging" })).toBe(false);
  });

  it("keeps the current install", () => {
    expect(isOutdatedStreamInstall({ ...productionInstall, directoryName: "1.13.9" })).toBe(false);
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.13.9-staging" })).toBe(false);
  });

  it("keeps newer installs, such as a dev build or a later release someone chose", () => {
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.13.99-staging" })).toBe(false);
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.19.0-staging" })).toBe(false);
    expect(isOutdatedStreamInstall({ ...productionInstall, directoryName: "2.0.0" })).toBe(false);
  });

  it("never prunes another stream's runner", () => {
    expect(isOutdatedStreamInstall({ ...productionInstall, directoryName: "1.13.9-staging" })).toBe(false);
    expect(isOutdatedStreamInstall({ ...productionInstall, directoryName: "1.10.6-staging" })).toBe(false);
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.13.9" })).toBe(false);
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.10.6" })).toBe(false);
  });

  it("ignores directories that are not studio installs", () => {
    expect(isOutdatedStreamInstall({ ...productionInstall, directoryName: "logs" })).toBe(false);
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "logs-staging" })).toBe(false);
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.0.0-emg-staging" })).toBe(false);
  });
});

describe("shouldKeepVersionOverride", () => {
  it("keeps an override naming a release newer than the bundled one", () => {
    expect(shouldKeepVersionOverride({ overrideVersion: "1.20.0", bundledVersion: "1.17.0" })).toBe(true);
    expect(shouldKeepVersionOverride({ overrideVersion: "1.17.99", bundledVersion: "1.17.0" })).toBe(true);
  });

  it("resets an override the bundled version has caught up with", () => {
    expect(shouldKeepVersionOverride({ overrideVersion: "1.17.0", bundledVersion: "1.17.0" })).toBe(false);
    expect(shouldKeepVersionOverride({ overrideVersion: "1.16.2", bundledVersion: "1.17.0" })).toBe(false);
  });

  it("resets an override naming a non-release build", () => {
    expect(shouldKeepVersionOverride({ overrideVersion: "1.17.0-emg", bundledVersion: "1.17.0" })).toBe(false);
    expect(shouldKeepVersionOverride({ overrideVersion: "latest", bundledVersion: "1.17.0" })).toBe(false);
  });
});

describe("parseElectronAppDirName", () => {
  it.each(Object.values(ElectronAppReleaseStream))(
    "reads back the %s stream's directory name",
    (releaseStream) => {
      const directoryName = buildRuntimeDirName({ version: "1.13.9", releaseStream: releaseStream });
      expect(parseElectronAppDirName(directoryName)).toEqual({ version: "1.13.9", releaseStream: releaseStream });
    },
  );

  it("rejects names no stream installs into", () => {
    const foreignDirectoryNames = ["logs", "logs-staging", "1.13.9-beta", "1.13.9-staging-old", "v1.13.9", "1.13", "1.13.9.1"];
    for (const directoryName of foreignDirectoryNames) {
      expect(parseElectronAppDirName(directoryName)).toBeNull();
    }
  });

  it.each(Object.keys(runtimeTargets.streams))(
    "agrees with the postinstall on which directories belong to the %s stream",
    (releaseStream) => {
      const directoryNames = ["1.13.9", "1.13.9-staging", "1.10.6-staging", "logs", "logs-staging", "1.13.9-beta", "1.13.9-production"];
      for (const directoryName of directoryNames) {
        expect(isStreamInstall({ directoryName: directoryName, releaseStream: releaseStream })).toBe(
          parseElectronAppDirName(directoryName)?.releaseStream === releaseStream,
        );
      }
    },
  );
});
