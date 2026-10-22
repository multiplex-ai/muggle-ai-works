import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  isElectronAppPlatform,
  resolveElectronAppExecutablePath,
} from "../shared/electron-app-executable.js";

const INSTALL_DIR = join("/data", "electron-app", "1.13.9");

describe("resolveElectronAppExecutablePath", () => {
  it("resolves the Linux executable under its electron-builder name", () => {
    expect(resolveElectronAppExecutablePath({ installDir: INSTALL_DIR, platformName: "linux" })).toBe(
      join(INSTALL_DIR, "muggle-ai-studio"),
    );
  });

  it("resolves the macOS executable inside the app bundle", () => {
    expect(resolveElectronAppExecutablePath({ installDir: INSTALL_DIR, platformName: "darwin" })).toBe(
      join(INSTALL_DIR, "MuggleAI.app", "Contents", "MacOS", "MuggleAI"),
    );
  });

  it("resolves the Windows executable", () => {
    expect(resolveElectronAppExecutablePath({ installDir: INSTALL_DIR, platformName: "win32" })).toBe(
      join(INSTALL_DIR, "MuggleAI.exe"),
    );
  });

  it("rejects a platform no studio build is published for", () => {
    expect(() => resolveElectronAppExecutablePath({ installDir: INSTALL_DIR, platformName: "freebsd" })).toThrow(
      "Unsupported platform: freebsd",
    );
  });
});

describe("isElectronAppPlatform", () => {
  it("accepts only platforms with a published studio build", () => {
    expect(["darwin", "win32", "linux", "freebsd", "aix"].filter(isElectronAppPlatform)).toEqual([
      "darwin",
      "win32",
      "linux",
    ]);
  });
});
