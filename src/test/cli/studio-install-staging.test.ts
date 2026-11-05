import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDirState = vi.hoisted(() => ({ path: "" }));
const renameFailures = vi.hoisted(() => ({ next: [] as Array<Error | null> }));

vi.mock("../../../packages/mcps/src/index.js", () => ({ getDataDir: () => dataDirState.path }));

vi.mock("fs", async (importOriginal) => {
  const actualFs = await importOriginal<typeof import("fs")>();
  return {
    ...actualFs,
    renameSync: vi.fn((fromPath: string, toPath: string) => {
      const injectedFailure = renameFailures.next.shift();
      if (injectedFailure) {
        throw injectedFailure;
      }
      actualFs.renameSync(fromPath, toPath);
    }),
  };
});

import {
  discardStudioStagingDir,
  getStudioStagingDir,
  prepareStudioStagingDir,
  replaceStudioInstall,
} from "../../cli/studio-install-staging.js";

/** An error carrying a node error code, as a held file on Windows raises. */
function fileError(code: string): Error {
  return Object.assign(new Error(`${code}: rename failed`), { code: code });
}

describe("staged Studio installs", () => {
  let versionDir: string;
  let stagingDir: string;

  beforeEach(() => {
    dataDirState.path = mkdtempSync(join(tmpdir(), "mgl-studio-stage-"));
    renameFailures.next = [];
    versionDir = join(dataDirState.path, "electron-app", "2.0.0");
    stagingDir = getStudioStagingDir(versionDir);
    prepareStudioStagingDir({ stagingDir: stagingDir, versionDir: versionDir });
    writeFileSync(join(stagingDir, "marker"), "new");
  });

  afterEach(() => {
    rmSync(dataDirState.path, { recursive: true, force: true });
  });

  function seedInstall(): void {
    mkdirSync(versionDir, { recursive: true });
    writeFileSync(join(versionDir, "marker"), "old");
  }

  it("stages outside the directory installs are listed from", () => {
    expect(stagingDir.startsWith(join(dataDirState.path, "electron-app"))).toBe(false);
  });

  it("clears what a crashed run left in staging", () => {
    seedInstall();
    writeFileSync(join(stagingDir, "leftover"), "stale");
    mkdirSync(`${stagingDir}.retired`, { recursive: true });

    prepareStudioStagingDir({ stagingDir: stagingDir, versionDir: versionDir });

    expect(existsSync(join(stagingDir, "leftover"))).toBe(false);
    expect(existsSync(`${stagingDir}.retired`)).toBe(false);
    expect(readFileSync(join(versionDir, "marker"), "utf-8")).toBe("old");
  });

  it("restores an install a run was killed in the middle of swapping", () => {
    mkdirSync(`${stagingDir}.retired`, { recursive: true });
    writeFileSync(join(`${stagingDir}.retired`, "marker"), "old");
    mkdirSync(join(versionDir, ".."), { recursive: true });

    prepareStudioStagingDir({ stagingDir: stagingDir, versionDir: versionDir });

    expect(readFileSync(join(versionDir, "marker"), "utf-8")).toBe("old");
    expect(existsSync(`${stagingDir}.retired`)).toBe(false);
  });

  it("moves a staged version in when nothing is installed yet", async () => {
    await replaceStudioInstall({ stagingDir: stagingDir, versionDir: versionDir });

    expect(readFileSync(join(versionDir, "marker"), "utf-8")).toBe("new");
    expect(existsSync(stagingDir)).toBe(false);
  });

  it("replaces an install and leaves no retired copy behind", async () => {
    seedInstall();

    await replaceStudioInstall({ stagingDir: stagingDir, versionDir: versionDir });

    expect(readFileSync(join(versionDir, "marker"), "utf-8")).toBe("new");
    expect(existsSync(`${stagingDir}.retired`)).toBe(false);
  });

  it("leaves the install alone when it cannot be moved aside", async () => {
    seedInstall();
    renameFailures.next = [fileError("ENOTEMPTY")];

    await expect(replaceStudioInstall({ stagingDir: stagingDir, versionDir: versionDir })).rejects.toThrow(
      "It was left as it was",
    );

    expect(readFileSync(join(versionDir, "marker"), "utf-8")).toBe("old");
  });

  it("restores the old install when the new one cannot move in", async () => {
    seedInstall();
    renameFailures.next = [null, fileError("ENOENT")];

    await expect(replaceStudioInstall({ stagingDir: stagingDir, versionDir: versionDir })).rejects.toThrow("ENOENT");

    expect(readFileSync(join(versionDir, "marker"), "utf-8")).toBe("old");
    expect(existsSync(`${stagingDir}.retired`)).toBe(false);
  });

  it("waits out a brief lock on the staged files", async () => {
    renameFailures.next = [fileError("EPERM"), fileError("EBUSY")];

    await replaceStudioInstall({ stagingDir: stagingDir, versionDir: versionDir });

    expect(readFileSync(join(versionDir, "marker"), "utf-8")).toBe("new");
  });

  it("gives up on a lock that never clears, and keeps the install", async () => {
    seedInstall();
    renameFailures.next = Array.from({ length: 10 }, () => fileError("EPERM"));

    await expect(replaceStudioInstall({ stagingDir: stagingDir, versionDir: versionDir })).rejects.toThrow(
      "may be in use",
    );

    expect(readFileSync(join(versionDir, "marker"), "utf-8")).toBe("old");
  });

  it("discards a staging directory", () => {
    discardStudioStagingDir(stagingDir);

    expect(existsSync(stagingDir)).toBe(false);
  });
});
