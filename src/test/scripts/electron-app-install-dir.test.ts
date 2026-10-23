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
  });

  it("keeps the current install", () => {
    expect(isOutdatedStreamInstall({ ...productionInstall, directoryName: "1.13.9" })).toBe(false);
    expect(isOutdatedStreamInstall({ ...stagingInstall, directoryName: "1.13.9-staging" })).toBe(false);
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
        expect(
          isOutdatedStreamInstall({ directoryName: directoryName, releaseStream: releaseStream, currentDirectoryName: "" }),
        ).toBe(parseElectronAppDirName(directoryName)?.releaseStream === releaseStream);
      }
    },
  );
});
