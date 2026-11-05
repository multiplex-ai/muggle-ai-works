import * as fs from "fs/promises";
import * as path from "path";

import { resolveElectronAppResourcesDir } from "../../../shared/electron-app-executable.js";
import { getLogger } from "../../../shared/logger.js";
import { isValidManifest } from "../../../shared/release_manifest.js";
import type { IStudioBuild } from "../types/run-result-storage-types.js";
import { STUDIO_MANIFEST_SERVICE_NAME, STUDIO_RELEASE_MANIFEST_FILE_NAME } from "./studio-build-constants.js";

/**
 * The build of a studio executable, read from the release manifest packaged with it, so a run
 * record names the code that ran rather than the version this server expected.
 *
 * @param params.executablePath - The studio executable the run spawns.
 * @param params.platformName - Platform as `os.platform()` reports it.
 * @returns The build, or undefined when the executable has no readable studio manifest; the run goes ahead unstamped.
 */
export async function readStudioBuildAsync(params: {
  executablePath: string;
  platformName: string;
}): Promise<IStudioBuild | undefined> {
  try {
    const resourcesDir = resolveElectronAppResourcesDir({
      executablePath: params.executablePath,
      platformName: params.platformName,
    });
    const manifestRaw = await fs.readFile(path.join(resourcesDir, STUDIO_RELEASE_MANIFEST_FILE_NAME), "utf-8");
    const manifest: unknown = JSON.parse(manifestRaw);
    if (!isValidManifest(manifest) || manifest.serviceName !== STUDIO_MANIFEST_SERVICE_NAME) return undefined;
    return {
      commitSha: manifest.commitSha,
      buildId: manifest.buildId,
      buildTime: manifest.buildTime,
      executablePath: params.executablePath,
    };
  } catch (error) {
    getLogger().debug("No readable studio release manifest", {
      executablePath: params.executablePath,
      error: String(error),
    });
    return undefined;
  }
}
