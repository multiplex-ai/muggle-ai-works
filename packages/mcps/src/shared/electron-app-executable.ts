import * as path from "path";

import { ELECTRON_APP_EXECUTABLE_PATH_SEGMENTS } from "./electron-app-executable-constants.js";
import { ElectronAppPlatform } from "./electron-app-executable-types.js";

/**
 * Whether a studio build is published for a platform.
 * @param platformName - Platform as `os.platform()` reports it.
 * @returns True for darwin, win32 and linux.
 */
export function isElectronAppPlatform(platformName: string): platformName is ElectronAppPlatform {
  return (Object.values(ElectronAppPlatform) as string[]).includes(platformName);
}

/**
 * Resolve the studio executable inside the directory a release archive was extracted into.
 * @param params - Resolution parameters.
 * @param params.installDir - Directory holding the extracted archive.
 * @param params.platformName - Platform as `os.platform()` reports it.
 * @returns Executable path, for example `<installDir>/muggle-ai-studio` on Linux.
 * @throws Error when no studio build is published for the platform.
 */
export function resolveElectronAppExecutablePath(params: {
  installDir: string;
  platformName: string;
}): string {
  if (!isElectronAppPlatform(params.platformName)) {
    throw new Error(`Unsupported platform: ${params.platformName}`);
  }

  return path.join(params.installDir, ...ELECTRON_APP_EXECUTABLE_PATH_SEGMENTS[params.platformName]);
}
