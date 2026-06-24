import { describe, expect, it } from "vitest";

import { describeElectronSpawnFailure } from "../mcp/local/services/spawn-failure-message.js";

const spawnUnknown = Object.assign(new Error("spawn UNKNOWN"), {
  code: "UNKNOWN",
}) as NodeJS.ErrnoException;

describe("describeElectronSpawnFailure", () => {
  it("explains the Smart App Control block on a Windows spawn UNKNOWN", () => {
    const message = describeElectronSpawnFailure({
      error: spawnUnknown,
      electronAppPath: "C:/Users/me/.muggle-ai/electron-app/1.5.1/MuggleAI.exe",
      platform: "win32",
    });
    expect(message).toContain("spawn UNKNOWN");
    expect(message).toContain("Smart App Control");
    expect(message).toContain("MuggleAI.exe");
    expect(message).toContain("Smart App Control > Off");
  });

  it("treats EPERM on Windows as the same block", () => {
    const message = describeElectronSpawnFailure({
      error: Object.assign(new Error("spawn EPERM"), { code: "EPERM" }) as NodeJS.ErrnoException,
      electronAppPath: "C:/x/MuggleAI.exe",
      platform: "win32",
    });
    expect(message).toContain("Smart App Control");
  });

  it("returns only the base message for unrelated Windows errors", () => {
    const message = describeElectronSpawnFailure({
      error: Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }) as NodeJS.ErrnoException,
      electronAppPath: "C:/x/MuggleAI.exe",
      platform: "win32",
    });
    expect(message).toBe("Failed to start electron-app: spawn ENOENT");
    expect(message).not.toContain("Smart App Control");
  });

  it("does not blame App Control on non-Windows platforms", () => {
    const message = describeElectronSpawnFailure({
      error: spawnUnknown,
      electronAppPath: "/x/MuggleAI",
      platform: "linux",
    });
    expect(message).toBe("Failed to start electron-app: spawn UNKNOWN");
  });
});
