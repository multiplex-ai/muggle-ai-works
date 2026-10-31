import { describe, it, expect, vi, inject } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { spawnSync } from "child_process";
import {
  RUN_TEMP_ROOT_CONTEXT_KEY,
  RUN_TEMP_ROOT_PREFIX,
  STALE_RUN_TEMP_ROOT_AGE_MS,
  TEMP_DIR_ENV_KEYS,
} from "./constants.js";
import { createRunTempRoot, pointTempEnvAt, removeRunTempRoot, sweepStaleRunTempRoots } from "./runTempRoot.js";

vi.mock("fs", async (importOriginal) => {
  const actualFs = await importOriginal<typeof import("fs")>();
  return { ...actualFs, rmSync: vi.fn(actualFs.rmSync) };
});

function setModifiedTime(targetPath: string, modifiedAtMs: number): void {
  const modifiedAtSeconds = modifiedAtMs / 1000;
  utimesSync(targetPath, modifiedAtSeconds, modifiedAtSeconds);
}

describe("run temp root wiring", () => {
  it("points this worker's os.tmpdir() at the run root", () => {
    const runTempRoot = inject(RUN_TEMP_ROOT_CONTEXT_KEY);
    expect(basename(runTempRoot).startsWith(RUN_TEMP_ROOT_PREFIX)).toBe(true);
    expect(tmpdir()).toBe(runTempRoot);
  });

  it("hands the run root to processes a test spawns", () => {
    const childTempDir = spawnSync(process.execPath, ["-e", "process.stdout.write(require('os').tmpdir())"], {
      encoding: "utf-8",
    }).stdout;
    expect(childTempDir).toBe(inject(RUN_TEMP_ROOT_CONTEXT_KEY));
  });
});

describe("createRunTempRoot", () => {
  it("creates a prefixed directory under the given temp dir", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "create-root-base-"));
    const runTempRoot = createRunTempRoot(baseDir);
    expect(existsSync(runTempRoot)).toBe(true);
    expect(join(runTempRoot, "..")).toBe(baseDir);
    expect(basename(runTempRoot).startsWith(RUN_TEMP_ROOT_PREFIX)).toBe(true);
  });
});

describe("pointTempEnvAt", () => {
  it("sets every env var os.tmpdir() reads", () => {
    const childEnv: NodeJS.ProcessEnv = {};
    pointTempEnvAt(childEnv, "/runs/root");
    for (const envKey of TEMP_DIR_ENV_KEYS) {
      expect(childEnv[envKey], envKey).toBe("/runs/root");
    }
  });
});

describe("removeRunTempRoot", () => {
  it("removes the root and everything under it", () => {
    const runTempRoot = mkdtempSync(join(tmpdir(), "remove-root-"));
    mkdirSync(join(runTempRoot, "fixture", "nested"), { recursive: true });
    writeFileSync(join(runTempRoot, "fixture", "nested", "state.json"), "{}");
    expect(removeRunTempRoot(runTempRoot)).toBe(true);
    expect(existsSync(runTempRoot)).toBe(false);
  });

  it("reports a root a process still holds instead of throwing", async () => {
    const runTempRoot = mkdtempSync(join(tmpdir(), "locked-root-"));
    // The setup file loaded runTempRoot.js against the real fs before this file's mock existed.
    vi.resetModules();
    const { removeRunTempRoot: removeWithMockedFs } = await import("./runTempRoot.js");
    vi.mocked(rmSync).mockImplementationOnce(() => {
      throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
    });
    expect(removeWithMockedFs(runTempRoot)).toBe(false);
    expect(existsSync(runTempRoot)).toBe(true);
  });
});

describe("sweepStaleRunTempRoots", () => {
  it("removes only run roots older than the stale age", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "sweep-base-"));
    const nowMs = Date.now();
    const staleModifiedMs = nowMs - STALE_RUN_TEMP_ROOT_AGE_MS - 60_000;
    const staleRoot = join(baseDir, `${RUN_TEMP_ROOT_PREFIX}stale1`);
    const liveRoot = join(baseDir, `${RUN_TEMP_ROOT_PREFIX}live01`);
    const unrelatedDir = join(baseDir, "other-tool-abc123");
    const prefixedFile = join(baseDir, `${RUN_TEMP_ROOT_PREFIX}file01`);
    for (const directoryPath of [staleRoot, liveRoot, unrelatedDir]) mkdirSync(directoryPath);
    writeFileSync(prefixedFile, "");
    for (const oldPath of [staleRoot, unrelatedDir, prefixedFile]) setModifiedTime(oldPath, staleModifiedMs);

    expect(sweepStaleRunTempRoots(baseDir, nowMs)).toEqual([staleRoot]);
    expect(existsSync(staleRoot)).toBe(false);
    expect(existsSync(liveRoot)).toBe(true);
    expect(existsSync(unrelatedDir)).toBe(true);
    expect(existsSync(prefixedFile)).toBe(true);
  });
});
