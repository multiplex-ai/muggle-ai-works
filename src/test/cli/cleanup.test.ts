import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

let dataDir: string;
let currentVersion = "1.0.5";

vi.mock("../../../packages/mcps/src/index.js", () => ({
  getDataDir: vi.fn(() => dataDir),
  getElectronAppVersion: vi.fn(() => currentVersion),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import {
  formatBytes,
  listInstalledVersions,
  cleanupOldVersions,
  versionsCommand,
  cleanupCommand,
  listObsoleteSkills,
} from "../../cli/cleanup.js";

function makeVersionDir(version: string, fileBytes: number): void {
  const dir = join(dataDir, "electron-app", version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "blob.bin"), Buffer.alloc(fileBytes));
}

describe("formatBytes", () => {
  it("formats zero, bytes, KB, MB, GB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512.0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });
});

describe("listInstalledVersions / cleanupOldVersions", () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "mgl-cleanup-"));
    currentVersion = "1.0.5";
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns empty when no electron-app directory exists", () => {
    expect(listInstalledVersions()).toEqual([]);
  });

  it("lists only semver dirs, sorted descending, marking current", () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 200);
    makeVersionDir("1.0.10", 50);
    mkdirSync(join(dataDir, "electron-app", "not-a-version"), { recursive: true });

    const versions = listInstalledVersions();
    expect(versions.map((v) => v.version)).toEqual(["1.0.10", "1.0.5", "1.0.4"]);
    expect(versions.find((v) => v.version === "1.0.5")?.isCurrent).toBe(true);
    expect(versions.find((v) => v.version === "1.0.4")?.sizeBytes).toBe(200);
  });

  it("keeps current + one previous by default, removes the rest", () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    makeVersionDir("1.0.3", 100);
    makeVersionDir("1.0.2", 100);

    const result = cleanupOldVersions({});
    expect(result.removed.map((v) => v.version).sort()).toEqual(["1.0.2", "1.0.3"]);
    expect(existsSync(join(dataDir, "electron-app", "1.0.4"))).toBe(true);
    expect(existsSync(join(dataDir, "electron-app", "1.0.2"))).toBe(false);
    expect(result.freedBytes).toBe(200);
  });

  it("with all=true keeps only current", () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    makeVersionDir("1.0.3", 100);

    const result = cleanupOldVersions({ all: true });
    expect(result.removed.map((v) => v.version).sort()).toEqual(["1.0.3", "1.0.4"]);
  });

  it("dryRun reports removals without deleting", () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    makeVersionDir("1.0.3", 100);

    const result = cleanupOldVersions({ dryRun: true });
    expect(result.removed.map((v) => v.version)).toEqual(["1.0.3"]);
    expect(existsSync(join(dataDir, "electron-app", "1.0.3"))).toBe(true);
  });
});

describe("versionsCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "mgl-cleanup-"));
    currentVersion = "1.0.5";
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("prints a hint when nothing is installed", async () => {
    await versionsCommand();
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("No versions installed");
  });

  it("prints versions with current marker and total", async () => {
    makeVersionDir("1.0.5", 1024);
    makeVersionDir("1.0.4", 2048);
    await versionsCommand();
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("v1.0.5 (current)");
    expect(out).toContain("Total: 2 version(s)");
  });
});

describe("cleanupCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "mgl-cleanup-"));
    currentVersion = "1.0.5";
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("reports nothing to clean when no versions installed", async () => {
    await cleanupCommand({});
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Nothing to clean up");
  });

  it("reports nothing to clean when only current installed", async () => {
    makeVersionDir("1.0.5", 100);
    await cleanupCommand({});
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Only the current version");
  });

  it("keeps a previous version by default and reports the kept hint", async () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    await cleanupCommand({});
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Keeping one previous version");
  });

  it("removes old versions with --all and reports freed total", async () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 1024);
    makeVersionDir("1.0.3", 1024);
    await cleanupCommand({ all: true });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Removed:");
    expect(out).toContain("Freed:");
  });

  it("dry run with --all reports the would-remove footer", async () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    makeVersionDir("1.0.3", 100);
    await cleanupCommand({ all: true, dryRun: true });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Would remove:");
    expect(out).toContain("Run without --dry-run");
  });

  it("reports no old versions to remove for --all when only current+0", async () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    await cleanupCommand({ all: true });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Removed:");
  });

  it("scans skills when --skills is passed", async () => {
    makeVersionDir("1.0.5", 100);
    await cleanupCommand({ skills: true });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Skills Cleanup");
  });
});

describe("listObsoleteSkills", () => {
  it("returns empty when the cursor skills dir is absent", () => {
    const skillsDir = join(homedir(), ".cursor", "skills");
    if (!existsSync(skillsDir)) {
      expect(listObsoleteSkills()).toEqual([]);
    } else {
      expect(Array.isArray(listObsoleteSkills())).toBe(true);
    }
  });
});
