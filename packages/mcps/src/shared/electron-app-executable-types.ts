/**
 * Electron-app executable model for @muggleai/works.
 */

/** Operating system a studio build is published for, named as `os.platform()` reports it. */
export enum ElectronAppPlatform {
  Darwin = "darwin",
  Win32 = "win32",
  Linux = "linux",
}
