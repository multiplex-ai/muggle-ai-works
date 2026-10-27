import { describe, expect, it } from "vitest";

import { findInstallDirectoryNamesInProcessPaths } from "../../../scripts/running-studio-installs.mjs";

describe("findInstallDirectoryNamesInProcessPaths", () => {
  it("names the Windows install directory a running studio executes from, ignoring case", () => {
    const runningDirectoryNames = findInstallDirectoryNamesInProcessPaths({
      appDir: "C:\\Users\\dev\\.muggle-ai\\electron-app",
      processPaths: [
        "C:\\Users\\dev\\.muggle-ai\\electron-app\\1.17.99-staging\\MuggleAI.exe",
        "C:\\USERS\\DEV\\.MUGGLE-AI\\ELECTRON-APP\\1.16.0-Staging\\MuggleAI.exe",
        "C:\\Program Files\\nodejs\\node.exe",
      ],
      isCaseInsensitive: true,
    });

    expect([...runningDirectoryNames].sort()).toEqual(["1.16.0-staging", "1.17.99-staging"]);
  });

  it("names the macOS install directory from a command line inside the app bundle", () => {
    const runningDirectoryNames = findInstallDirectoryNamesInProcessPaths({
      appDir: "/Users/dev/.muggle-ai/electron-app/",
      processPaths: [
        "/Users/dev/.muggle-ai/electron-app/1.19.0-staging/MuggleAI.app/Contents/MacOS/MuggleAI --type=renderer",
        "/usr/sbin/cfprefsd agent",
      ],
      isCaseInsensitive: false,
    });

    expect([...runningDirectoryNames]).toEqual(["1.19.0-staging"]);
  });

  it("does not match a sibling directory that only shares the app directory's prefix", () => {
    const runningDirectoryNames = findInstallDirectoryNamesInProcessPaths({
      appDir: "/home/dev/.muggle-ai/electron-app",
      processPaths: ["/home/dev/.muggle-ai/electron-app-backup/1.10.0/MuggleAI"],
      isCaseInsensitive: false,
    });

    expect(runningDirectoryNames.size).toBe(0);
  });

  it("keeps case on case-sensitive platforms", () => {
    const runningDirectoryNames = findInstallDirectoryNamesInProcessPaths({
      appDir: "/home/dev/.muggle-ai/electron-app",
      processPaths: ["/HOME/dev/.muggle-ai/electron-app/1.10.0/MuggleAI"],
      isCaseInsensitive: false,
    });

    expect(runningDirectoryNames.size).toBe(0);
  });
});
