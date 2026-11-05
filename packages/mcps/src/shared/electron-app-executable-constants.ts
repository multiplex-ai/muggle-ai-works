import { ElectronAppPlatform } from "./electron-app-executable-types.js";

/**
 * Path of the studio executable inside an extracted release archive, as path segments.
 *
 * The Linux archive ships electron-builder's executable name, not the product name the
 * macOS and Windows builds use.
 */
export const ELECTRON_APP_EXECUTABLE_PATH_SEGMENTS: Readonly<Record<ElectronAppPlatform, readonly string[]>> = {
  [ElectronAppPlatform.Darwin]: ["MuggleAI.app", "Contents", "MacOS", "MuggleAI"],
  [ElectronAppPlatform.Win32]: ["MuggleAI.exe"],
  [ElectronAppPlatform.Linux]: ["muggle-ai-studio"],
};

/**
 * Where a packaged studio keeps its resources, relative to the directory of its executable, as
 * path segments: the location Electron reports as `process.resourcesPath` in the running app.
 */
export const ELECTRON_APP_RESOURCES_PATH_SEGMENTS: Readonly<Record<ElectronAppPlatform, readonly string[]>> = {
  [ElectronAppPlatform.Darwin]: ["..", "Resources"],
  [ElectronAppPlatform.Win32]: ["resources"],
  [ElectronAppPlatform.Linux]: ["resources"],
};

/** Release asset listing the SHA256 of every studio archive in its release. */
export const ELECTRON_APP_CHECKSUMS_ASSET_NAME = "checksums.txt";
