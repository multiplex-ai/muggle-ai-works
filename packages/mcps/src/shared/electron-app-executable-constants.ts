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
