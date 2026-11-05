import * as fs from "fs/promises";
import * as os from "node:os";
import * as path from "path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readStudioBuildAsync } from "../mcp/local/services/studio-build.js";
import { STUDIO_MANIFEST_SERVICE_NAME } from "../mcp/local/services/studio-build-constants.js";
import { ElectronAppPlatform } from "../shared/electron-app-executable-types.js";

const RELEASE_MANIFEST = {
  release: "20261103234154",
  buildId: "20261103234154",
  commitSha: "cda91cd17932375d4a2590e38da05d8f4677b56d",
  buildTime: "2026-11-03T23:41:54Z",
  serviceName: STUDIO_MANIFEST_SERVICE_NAME,
};

describe("readStudioBuildAsync", () => {
  let installDir: string;

  const writeManifestAsync = async (resourcesRelativeDir: string, manifestText: string): Promise<void> => {
    const resourcesDir = path.join(installDir, resourcesRelativeDir);
    await fs.mkdir(resourcesDir, { recursive: true });
    await fs.writeFile(path.join(resourcesDir, "release-manifest.json"), manifestText);
  };

  beforeEach(async () => {
    installDir = await fs.mkdtemp(path.join(os.tmpdir(), "muggle-studio-build-"));
  });

  afterEach(async () => {
    await fs.rm(installDir, { recursive: true, force: true });
  });

  it("reads the manifest packaged with a Windows or Linux executable", async () => {
    await writeManifestAsync("resources", JSON.stringify(RELEASE_MANIFEST));
    const executablePath = path.join(installDir, "MuggleAI.exe");

    for (const platformName of [ElectronAppPlatform.Win32, ElectronAppPlatform.Linux]) {
      expect(await readStudioBuildAsync({ executablePath: executablePath, platformName: platformName })).toEqual({
        commitSha: RELEASE_MANIFEST.commitSha,
        buildId: RELEASE_MANIFEST.buildId,
        buildTime: RELEASE_MANIFEST.buildTime,
        executablePath: executablePath,
      });
    }
  });

  it("reads the manifest inside a macOS app bundle", async () => {
    await writeManifestAsync(path.join("MuggleAI.app", "Contents", "Resources"), JSON.stringify(RELEASE_MANIFEST));
    const executablePath = path.join(installDir, "MuggleAI.app", "Contents", "MacOS", "MuggleAI");

    const studioBuild = await readStudioBuildAsync({ executablePath: executablePath, platformName: ElectronAppPlatform.Darwin });

    expect(studioBuild?.commitSha).toBe(RELEASE_MANIFEST.commitSha);
  });

  it("records a local build's manifest as it stands, for crediting to refuse", async () => {
    await writeManifestAsync("resources", JSON.stringify({ ...RELEASE_MANIFEST, commitSha: "local", buildId: "local" }));

    const studioBuild = await readStudioBuildAsync({
      executablePath: path.join(installDir, "MuggleAI.exe"),
      platformName: ElectronAppPlatform.Win32,
    });

    expect(studioBuild).toMatchObject({ commitSha: "local", buildId: "local" });
  });

  it("yields nothing for a missing, unparseable, incomplete, or foreign manifest, or an unsupported platform", async () => {
    const executablePath = path.join(installDir, "MuggleAI.exe");
    const readWindowsBuildAsync = () => readStudioBuildAsync({ executablePath: executablePath, platformName: ElectronAppPlatform.Win32 });

    expect(await readWindowsBuildAsync()).toBeUndefined();
    for (const manifestText of [
      "not json",
      JSON.stringify({ ...RELEASE_MANIFEST, commitSha: 7 }),
      JSON.stringify({ ...RELEASE_MANIFEST, serviceName: "muggle-ai-works-mcp" }),
    ]) {
      await writeManifestAsync("resources", manifestText);
      expect(await readWindowsBuildAsync()).toBeUndefined();
    }
    await writeManifestAsync("resources", JSON.stringify(RELEASE_MANIFEST));
    expect(await readStudioBuildAsync({ executablePath: executablePath, platformName: "freebsd" })).toBeUndefined();
  });
});
