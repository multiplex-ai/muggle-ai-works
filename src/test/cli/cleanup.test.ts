import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, lstatSync, symlinkSync } from "fs";
import { tmpdir, homedir } from "os";
import { join } from "path";

import { ElectronAppReleaseStream } from "../../../packages/mcps/src/shared/runtime-target-types.js";

let dataDir: string;
let activeVersion = "1.0.5";
let activeReleaseStream = ElectronAppReleaseStream.Production;

vi.mock("../../../packages/mcps/src/index.js", async () => {
  const installDirModule = await vi.importActual<
    typeof import("../../../packages/mcps/src/shared/electron-app-install-dir.js")
  >("../../../packages/mcps/src/shared/electron-app-install-dir.js");
  const runtimeTargetTypes = await vi.importActual<
    typeof import("../../../packages/mcps/src/shared/runtime-target-types.js")
  >("../../../packages/mcps/src/shared/runtime-target-types.js");

  return {
    ElectronAppReleaseStream: runtimeTargetTypes.ElectronAppReleaseStream,
    parseElectronAppDirName: installDirModule.parseElectronAppDirName,
    getDataDir: vi.fn(() => dataDir),
    getActiveElectronAppReleaseStream: vi.fn(() => activeReleaseStream),
    getElectronAppDir: vi.fn(() =>
      join(
        dataDir,
        "electron-app",
        installDirModule.buildElectronAppDirName({ version: activeVersion, releaseStream: activeReleaseStream }),
      ),
    ),
    getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  };
});

import {
  formatBytes,
  listInstalledVersions,
  cleanupOldVersions,
  versionsCommand,
  cleanupCommand,
  listObsoleteSkills,
} from "../../cli/cleanup.js";
import { ElectronAppInstallKind } from "../../cli/cleanup-types.js";

function electronAppPath(directoryName: string): string {
  return join(dataDir, "electron-app", directoryName);
}

function makeVersionDir(directoryName: string, fileBytes: number): void {
  const dir = electronAppPath(directoryName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "blob.bin"), Buffer.alloc(fileBytes));
}

function makeLink(linkName: string, targetName: string): void {
  mkdirSync(join(dataDir, "electron-app"), { recursive: true });
  symlinkSync(electronAppPath(targetName), electronAppPath(linkName), process.platform === "win32" ? "junction" : "dir");
}

function isPresentOnDisk(directoryName: string): boolean {
  try {
    lstatSync(electronAppPath(directoryName));
    return true;
  } catch {
    return false;
  }
}

/** A staging CLI's machine: both streams installed, plus hand-made links whose targets were pruned. */
function makeMixedStreamInstallSet(): void {
  activeVersion = "1.13.13";
  activeReleaseStream = ElectronAppReleaseStream.Staging;
  makeVersionDir("1.13.13-staging", 300);
  makeVersionDir("1.13.9", 200);
  makeVersionDir("1.13.9-staging", 100);
  makeLink("1.0.113", "1.0.116");
  makeLink("1.10.3-staging", "1.10.6");
  makeLink("1.10.6-staging", "1.10.6");
  makeLink("1.6.11", "1.6.12");
  makeLink("1.9.0-staging", "1.10.3");
}

function captureConsoleOutput(logSpy: ReturnType<typeof vi.spyOn>): string {
  return logSpy.mock.calls.map((call) => String(call[0])).join("\n");
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
    activeVersion = "1.0.5";
    activeReleaseStream = ElectronAppReleaseStream.Production;
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns empty when no electron-app directory exists", () => {
    expect(listInstalledVersions()).toEqual([]);
  });

  it("lists only install directory names, sorted descending, marking the active one", () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 200);
    makeVersionDir("1.0.10", 50);
    mkdirSync(electronAppPath("not-a-version"), { recursive: true });
    mkdirSync(electronAppPath("1.0.6-beta"), { recursive: true });

    const versions = listInstalledVersions();
    expect(versions.map((v) => v.version)).toEqual(["1.0.10", "1.0.5", "1.0.4"]);
    expect(versions.find((v) => v.version === "1.0.5")?.isActive).toBe(true);
    expect(versions.find((v) => v.version === "1.0.4")?.sizeBytes).toBe(200);
  });

  it("lists every stream's installs and links, marking the active staging install", () => {
    makeMixedStreamInstallSet();

    const listing = listInstalledVersions().map((install) => ({
      directoryName: install.directoryName,
      releaseStream: install.releaseStream,
      kind: install.kind,
      isActive: install.isActive,
    }));

    expect(listing).toEqual([
      { directoryName: "1.13.9", releaseStream: "production", kind: ElectronAppInstallKind.Directory, isActive: false },
      { directoryName: "1.6.11", releaseStream: "production", kind: ElectronAppInstallKind.BrokenLink, isActive: false },
      { directoryName: "1.0.113", releaseStream: "production", kind: ElectronAppInstallKind.BrokenLink, isActive: false },
      { directoryName: "1.13.13-staging", releaseStream: "staging", kind: ElectronAppInstallKind.Directory, isActive: true },
      { directoryName: "1.13.9-staging", releaseStream: "staging", kind: ElectronAppInstallKind.Directory, isActive: false },
      { directoryName: "1.10.6-staging", releaseStream: "staging", kind: ElectronAppInstallKind.BrokenLink, isActive: false },
      { directoryName: "1.10.3-staging", releaseStream: "staging", kind: ElectronAppInstallKind.BrokenLink, isActive: false },
      { directoryName: "1.9.0-staging", releaseStream: "staging", kind: ElectronAppInstallKind.BrokenLink, isActive: false },
    ]);
  });

  it("lists a live link with its target and no size of its own", () => {
    activeVersion = "1.14.0";
    activeReleaseStream = ElectronAppReleaseStream.Staging;
    makeVersionDir("1.13.9-staging", 100);
    makeLink("1.14.0-staging", "1.13.9-staging");

    const activeLink = listInstalledVersions().find((install) => install.directoryName === "1.14.0-staging");
    expect(activeLink).toMatchObject({
      kind: ElectronAppInstallKind.Link,
      linkTarget: electronAppPath("1.13.9-staging"),
      sizeBytes: 0,
      isActive: true,
    });
  });

  it("keeps current + one previous by default, removes the rest", () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    makeVersionDir("1.0.3", 100);
    makeVersionDir("1.0.2", 100);

    const cleanupOutcome = cleanupOldVersions({});
    expect(cleanupOutcome.removed.map((v) => v.version).sort()).toEqual(["1.0.2", "1.0.3"]);
    expect(existsSync(electronAppPath("1.0.4"))).toBe(true);
    expect(existsSync(electronAppPath("1.0.2"))).toBe(false);
    expect(cleanupOutcome.freedBytes).toBe(200);
  });

  it("with all=true keeps only current", () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    makeVersionDir("1.0.3", 100);

    const cleanupOutcome = cleanupOldVersions({ all: true });
    expect(cleanupOutcome.removed.map((v) => v.version).sort()).toEqual(["1.0.3", "1.0.4"]);
  });

  it("dryRun reports removals without deleting", () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    makeVersionDir("1.0.3", 100);

    const cleanupOutcome = cleanupOldVersions({ dryRun: true });
    expect(cleanupOutcome.removed.map((v) => v.version)).toEqual(["1.0.3"]);
    expect(existsSync(electronAppPath("1.0.3"))).toBe(true);
  });

  it("never removes the active install, even when newer versions sit beside it", () => {
    makeVersionDir("1.0.7", 100);
    makeVersionDir("1.0.6", 100);
    makeVersionDir("1.0.5", 100);

    cleanupOldVersions({ all: true });
    expect(existsSync(electronAppPath("1.0.5"))).toBe(true);
  });

  it("removes only the active stream's old installs, never the other stream's", () => {
    makeMixedStreamInstallSet();

    const cleanupOutcome = cleanupOldVersions({ all: true });

    expect(cleanupOutcome.removed.map((v) => v.directoryName)).toEqual(["1.13.9-staging"]);
    expect(isPresentOnDisk("1.13.13-staging")).toBe(true);
    expect(isPresentOnDisk("1.13.9")).toBe(true);
  });

  it("never removes a production install from a staging CLI, however many there are", () => {
    activeVersion = "1.13.13";
    activeReleaseStream = ElectronAppReleaseStream.Staging;
    makeVersionDir("1.13.13-staging", 100);
    makeVersionDir("1.13.9", 100);
    makeVersionDir("1.13.8", 100);
    makeVersionDir("1.13.7", 100);

    expect(cleanupOldVersions({ all: true }).removed).toEqual([]);
    expect(["1.13.9", "1.13.8", "1.13.7"].every(isPresentOnDisk)).toBe(true);
  });

  it("never removes a staging install from a production CLI", () => {
    activeVersion = "1.13.9";
    makeVersionDir("1.13.9", 100);
    makeVersionDir("1.13.9-staging", 100);
    makeVersionDir("1.13.8-staging", 100);

    expect(cleanupOldVersions({ all: true }).removed).toEqual([]);
    expect(isPresentOnDisk("1.13.8-staging")).toBe(true);
  });

  it("keeps the directory the active link launches from", () => {
    activeVersion = "1.14.0";
    activeReleaseStream = ElectronAppReleaseStream.Staging;
    makeVersionDir("1.13.9-staging", 100);
    makeVersionDir("1.13.8-staging", 100);
    makeVersionDir("1.13.7-staging", 100);
    makeLink("1.14.0-staging", "1.13.7-staging");

    cleanupOldVersions({ all: true });

    expect(existsSync(join(electronAppPath("1.14.0-staging"), "blob.bin"))).toBe(true);
  });

  it("keeps a directory another stream's link launches from", () => {
    activeVersion = "1.13.9";
    makeVersionDir("1.13.9", 100);
    makeVersionDir("1.10.6", 100);
    makeVersionDir("1.10.5", 100);
    makeLink("1.10.6-staging", "1.10.6");

    const cleanupOutcome = cleanupOldVersions({ all: true });

    expect(cleanupOutcome.removed.map((v) => v.directoryName)).toEqual(["1.10.5"]);
    expect(existsSync(join(electronAppPath("1.10.6-staging"), "blob.bin"))).toBe(true);
  });

  it("never removes links, live or broken", () => {
    activeVersion = "1.13.9";
    makeVersionDir("1.13.9", 100);
    makeVersionDir("1.12.0", 100);
    makeLink("1.12.1", "1.12.0");
    makeLink("1.0.113", "1.0.116");

    cleanupOldVersions({ all: true });

    expect(isPresentOnDisk("1.12.1")).toBe(true);
    expect(isPresentOnDisk("1.0.113")).toBe(true);
  });
});

describe("versionsCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "mgl-cleanup-"));
    activeVersion = "1.0.5";
    activeReleaseStream = ElectronAppReleaseStream.Production;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("prints a hint when nothing is installed", async () => {
    await versionsCommand();
    expect(captureConsoleOutput(logSpy)).toContain("No versions installed");
  });

  it("prints versions with active marker and total", async () => {
    makeVersionDir("1.0.5", 1024);
    makeVersionDir("1.0.4", 2048);
    await versionsCommand();
    const out = captureConsoleOutput(logSpy);
    expect(out).toContain("v1.0.5 [production] (active)");
    expect(out).toContain("Total: 2 version(s)");
  });

  it("lists both streams with the active staging install, and broken links apart", async () => {
    makeMixedStreamInstallSet();

    await versionsCommand();
    const out = captureConsoleOutput(logSpy);

    expect(out).toContain(
      [
        "  v1.13.9 [production] - 200.0 B",
        "  v1.13.13 [staging] (active) - 300.0 B",
        "  v1.13.9 [staging] - 100.0 B",
      ].join("\n"),
    );
    expect(out).toContain("Total: 3 version(s), 600.0 B");
    expect(out).toContain("Broken links (target missing; nothing launches from them):");
    expect(out).toContain(`  1.10.6-staging -> ${electronAppPath("1.10.6")}`);
    expect(out).toContain(`  1.0.113 -> ${electronAppPath("1.0.116")}`);
  });

  it("prints a live link with its target", async () => {
    activeVersion = "1.14.0";
    activeReleaseStream = ElectronAppReleaseStream.Staging;
    makeVersionDir("1.13.9-staging", 100);
    makeLink("1.14.0-staging", "1.13.9-staging");

    await versionsCommand();

    expect(captureConsoleOutput(logSpy)).toContain(
      `  v1.14.0 [staging] (active) -> ${electronAppPath("1.13.9-staging")}`,
    );
  });
});

describe("cleanupCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "mgl-cleanup-"));
    activeVersion = "1.0.5";
    activeReleaseStream = ElectronAppReleaseStream.Production;
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("reports nothing to clean when no versions installed", async () => {
    await cleanupCommand({});
    expect(captureConsoleOutput(logSpy)).toContain("Nothing to clean up");
  });

  it("reports nothing to clean when only current installed", async () => {
    makeVersionDir("1.0.5", 100);
    await cleanupCommand({});
    expect(captureConsoleOutput(logSpy)).toContain("Only one production version is installed");
  });

  it("keeps a previous version by default and reports the kept hint", async () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    await cleanupCommand({});
    expect(captureConsoleOutput(logSpy)).toContain("Keeping one previous version");
  });

  it("removes old versions with --all and reports freed total", async () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 1024);
    makeVersionDir("1.0.3", 1024);
    await cleanupCommand({ all: true });
    const out = captureConsoleOutput(logSpy);
    expect(out).toContain("Removed:");
    expect(out).toContain("Freed:");
  });

  it("dry run with --all reports the would-remove footer", async () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    makeVersionDir("1.0.3", 100);
    await cleanupCommand({ all: true, dryRun: true });
    const out = captureConsoleOutput(logSpy);
    expect(out).toContain("Would remove:");
    expect(out).toContain("Run without --dry-run");
  });

  it("reports no old versions to remove for --all when only current+0", async () => {
    makeVersionDir("1.0.5", 100);
    makeVersionDir("1.0.4", 100);
    await cleanupCommand({ all: true });
    const out = captureConsoleOutput(logSpy);
    expect(out).toContain("Removed:");
  });

  it("counts and removes only the active stream's installs", async () => {
    makeMixedStreamInstallSet();

    await cleanupCommand({ all: true });
    const out = captureConsoleOutput(logSpy);

    expect(out).toContain("Active version: v1.13.13 [staging]");
    expect(out).toContain("Old staging versions: 1");
    expect(out).toContain("  v1.13.9 [staging] (100.0 B)");
    expect(isPresentOnDisk("1.13.9")).toBe(true);
  });

  it("scans skills when --skills is passed", async () => {
    makeVersionDir("1.0.5", 100);
    await cleanupCommand({ skills: true });
    expect(captureConsoleOutput(logSpy)).toContain("Skills Cleanup");
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
