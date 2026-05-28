import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const realFs = createRequire(import.meta.url)("fs") as typeof import("fs");

const fsState = vi.hoisted(() => ({
  existing: new Set<string>(),
  files: new Map<string, string>(),
  written: new Map<string, string>(),
}));

const mcpsMocks = vi.hoisted(() => ({
  buildElectronAppChecksumsUrl: vi.fn(() => "https://dl/checksums.txt"),
  buildElectronAppReleaseAssetUrl: vi.fn((p: { version: string }) => `https://dl/${p.version}/MuggleAI.zip`),
  calculateFileChecksum: vi.fn(async () => "exec-sum"),
  getDataDir: vi.fn(() => "/data"),
  getElectronAppDir: vi.fn((v: string) => `/data/electron-app/${v}`),
  getElectronAppVersion: vi.fn(() => "1.0.5"),
  getPlatformKey: vi.fn(() => "win32-x64"),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  verifyFileChecksum: vi.fn(async () => ({ valid: true, expected: "e", actual: "e" })),
}));

const cleanupMock = vi.hoisted(() => ({
  cleanupOldVersions: vi.fn(() => ({ removed: [], freedBytes: 0 })),
  formatBytes: vi.fn((b: number) => `${b} B`),
}));

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn((_c: string, _a: string[], cb: (e: Error | null) => void) => cb(null)),
}));
const streamMock = vi.hoisted(() => ({ pipeline: vi.fn(async () => undefined) }));

const osMock = vi.hoisted(() => ({ platform: vi.fn(() => "win32") }));
const procArch = vi.hoisted(() => ({ value: "x64" }));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, platform: osMock.platform };
});

const fsImpl = vi.hoisted(() => ({
  existsSync: vi.fn((p: string) => fsState.existing.has(p)),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  createWriteStream: vi.fn(() => ({ kind: "ws" })),
  writeFileSync: vi.fn((p: string, c: string) => fsState.written.set(p, c)),
  readFileSync: vi.fn((p: string) => fsState.files.get(p) ?? "{}"),
}));

vi.mock("fs", () => fsImpl);
vi.mock("child_process", () => childProcessMock);
vi.mock("stream/promises", () => streamMock);
vi.mock("../../../packages/mcps/src/index.js", () => mcpsMocks);
vi.mock("../../cli/cleanup.js", () => cleanupMock);

import {
  getEffectiveElectronAppVersion,
  upgradeCommand,
} from "../../cli/upgrade.js";

const VERSION_DIR_106 = "/data/electron-app/1.0.6";
const EXE_106 = join(VERSION_DIR_106, "MuggleAI.exe");

function stubFetchSequence(responses: Array<Record<string, unknown>>): void {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => responses[Math.min(i++, responses.length - 1)]),
  );
}

function releasesResponse(tags: string[]): Record<string, unknown> {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => tags.map((t) => ({ tag_name: t, prerelease: false, draft: false })),
  };
}

function downloadResponse(): Record<string, unknown> {
  return { ok: true, status: 200, statusText: "OK", body: { kind: "body" } };
}

describe("getEffectiveElectronAppVersion", () => {
  // getEffectiveElectronAppVersion reads the override via require("fs"), which
  // bypasses the ESM "fs" mock, so these scenarios use a real temp data dir.
  let realDataDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    fsState.existing.clear();
    fsState.files.clear();
    realDataDir = realFs.mkdtempSync(join(tmpdir(), "mgl-upgrade-"));
    mcpsMocks.getDataDir.mockReturnValue(realDataDir);
  });

  afterEach(() => {
    realFs.rmSync(realDataDir, { recursive: true, force: true });
    mcpsMocks.getDataDir.mockReturnValue("/data");
  });

  it("returns the bundled version when no override file exists", () => {
    expect(getEffectiveElectronAppVersion()).toBe("1.0.5");
  });

  it("returns the overridden version when the file is present and valid", () => {
    const overridePath = join(realDataDir, "electron-app-version-override.json");
    realFs.writeFileSync(overridePath,JSON.stringify({ version: "2.0.0" }));
    fsState.existing.add(overridePath);
    expect(getEffectiveElectronAppVersion()).toBe("2.0.0");
  });

  it("falls back to bundled version when the override file is malformed", () => {
    const overridePath = join(realDataDir, "electron-app-version-override.json");
    realFs.writeFileSync(overridePath,"{ not json");
    fsState.existing.add(overridePath);
    expect(getEffectiveElectronAppVersion()).toBe("1.0.5");
  });
});

describe("upgradeCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  const originalArch = process.arch;

  beforeEach(() => {
    vi.clearAllMocks();
    fsState.existing.clear();
    fsState.files.clear();
    fsState.written.clear();
    osMock.platform.mockReturnValue("win32");
    procArch.value = "x64";
    Object.defineProperty(process, "arch", { get: () => procArch.value, configurable: true });
    mcpsMocks.verifyFileChecksum.mockResolvedValue({ valid: true, expected: "e", actual: "e" });
    cleanupMock.cleanupOldVersions.mockReturnValue({ removed: [], freedBytes: 0 });
    childProcessMock.execFile.mockImplementation((_c, _a, cb) => cb(null));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    vi.unstubAllGlobals();
    Object.defineProperty(process, "arch", { value: originalArch, configurable: true });
  });

  it("--check reports an available update without downloading", async () => {
    stubFetchSequence([releasesResponse(["electron-app-v1.0.9"])]);
    await upgradeCommand({ check: true });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Latest version:  1.0.9");
    expect(out).toContain("Update available");
    expect(streamMock.pipeline).not.toHaveBeenCalled();
  });

  it("--check reports up-to-date when no newer release exists", async () => {
    stubFetchSequence([releasesResponse(["v1.0.5"])]);
    await upgradeCommand({ check: true });
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("latest version");
  });

  it("does nothing when already latest and not forced", async () => {
    stubFetchSequence([releasesResponse(["v1.0.5"])]);
    await upgradeCommand({});
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("already on the latest");
    expect(streamMock.pipeline).not.toHaveBeenCalled();
  });

  it("downloads and installs a newer release, then auto-cleans old versions", async () => {
    fsState.existing.add(join("/data/electron-app/1.0.6", "MuggleAI.exe"));
    cleanupMock.cleanupOldVersions.mockReturnValue({
      removed: [{ version: "1.0.3" }],
      freedBytes: 2048,
    } as never);
    stubFetchSequence([
      releasesResponse(["v1.0.6"]),
      downloadResponse(),
      { ok: true, status: 200, statusText: "OK", text: async () => "" },
    ]);

    await upgradeCommand({});

    expect(streamMock.pipeline).toHaveBeenCalledOnce();
    expect(fsState.written.has(join(VERSION_DIR_106, ".install-metadata.json"))).toBe(true);
    const overridePath = join("/data", "electron-app-version-override.json");
    expect(JSON.parse(fsState.written.get(overridePath) ?? "{}").version).toBe("1.0.6");
    expect(cleanupMock.cleanupOldVersions).toHaveBeenCalledWith({ all: false });
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Cleaned up 1 old version");
  });

  it("installs a specific --version using the parameterized download URL", async () => {
    fsState.existing.add(join("/data/electron-app/3.1.4", "MuggleAI.exe"));
    stubFetchSequence([
      downloadResponse(),
      { ok: true, status: 200, statusText: "OK", text: async () => "" },
    ]);
    await upgradeCommand({ version: "3.1.4" });
    expect(mcpsMocks.buildElectronAppReleaseAssetUrl).toHaveBeenCalledWith({
      version: "3.1.4",
      assetFileName: "MuggleAI-win32-x64.zip",
    });
    expect(fsState.written.has(join("/data/electron-app/3.1.4", ".install-metadata.json"))).toBe(true);
  });

  it("verifies a checksum parsed from checksums.txt", async () => {
    fsState.existing.add(EXE_106);
    mcpsMocks.verifyFileChecksum.mockResolvedValue({ valid: true, expected: "e", actual: "e" });
    const sum = "a".repeat(64);
    stubFetchSequence([
      releasesResponse(["v1.0.6"]),
      downloadResponse(),
      { ok: true, status: 200, statusText: "OK", text: async () => `${sum}  MuggleAI-win32-x64.zip\n` },
    ]);
    await upgradeCommand({});
    expect(mcpsMocks.verifyFileChecksum).toHaveBeenCalledWith(expect.any(String), sum);
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Checksum verified");
  });

  it("aborts the install when checksum verification fails", async () => {
    fsState.existing.add(EXE_106);
    mcpsMocks.verifyFileChecksum.mockResolvedValue({ valid: false, expected: "a", actual: "b" });
    const sum = "a".repeat(64);
    stubFetchSequence([
      releasesResponse(["v1.0.6"]),
      downloadResponse(),
      { ok: true, status: 200, statusText: "OK", text: async () => `${sum}  MuggleAI-win32-x64.zip\n` },
    ]);
    await upgradeCommand({});
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Upgrade failed");
  });

  it("exits 1 when the GitHub releases API errors", async () => {
    stubFetchSequence([{ ok: false, status: 500, statusText: "Server Error" }]);
    await upgradeCommand({ check: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 when extraction yields no executable", async () => {
    stubFetchSequence([
      releasesResponse(["v1.0.6"]),
      downloadResponse(),
      { ok: true, status: 200, statusText: "OK", text: async () => "" },
    ]);
    await upgradeCommand({});
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("re-downloads the current version when --force is set despite no update", async () => {
    fsState.existing.add(join("/data/electron-app/1.0.5", "MuggleAI.exe"));
    stubFetchSequence([
      releasesResponse(["v1.0.5"]),
      downloadResponse(),
      { ok: true, status: 200, statusText: "OK", text: async () => "" },
    ]);
    await upgradeCommand({ force: true });
    expect(streamMock.pipeline).toHaveBeenCalledOnce();
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("treats releases with no electron-app tag as up-to-date", async () => {
    stubFetchSequence([releasesResponse(["not-a-version"])]);
    await upgradeCommand({ check: true });
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("latest version");
  });

  it("skips prerelease and draft entries when scanning releases", async () => {
    let i = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        i++;
        if (i === 1) {
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => [
              { tag_name: "v9.9.9", prerelease: true, draft: false },
              { tag_name: "v8.8.8", prerelease: false, draft: true },
              { tag_name: "v1.0.7", prerelease: false, draft: false },
            ],
          };
        }
        return { ok: true, status: 200, statusText: "OK", text: async () => "" };
      }),
    );
    await upgradeCommand({ check: true });
    const out = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(out).toContain("Latest version:  1.0.7");
  });

  it("warns and skips verification when the checksums file is absent", async () => {
    fsState.existing.add(EXE_106);
    stubFetchSequence([
      releasesResponse(["v1.0.6"]),
      downloadResponse(),
      { ok: false, status: 404, statusText: "Not Found" },
    ]);
    await upgradeCommand({});
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("No checksum available");
  });

  it("exits 1 when the download response is not ok", async () => {
    stubFetchSequence([
      releasesResponse(["v1.0.6"]),
      { ok: false, status: 502, statusText: "Bad Gateway" },
    ]);
    await upgradeCommand({});
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Upgrade failed");
  });

  it("uses the unzip extractor and darwin executable path on macOS", async () => {
    osMock.platform.mockReturnValue("darwin");
    const darwinExe = join("/data/electron-app/1.0.6", "MuggleAI.app", "Contents", "MacOS", "MuggleAI");
    fsState.existing.add(darwinExe);
    procArch.value = "arm64";
    stubFetchSequence([
      releasesResponse(["v1.0.6"]),
      downloadResponse(),
      { ok: true, status: 200, statusText: "OK", text: async () => "" },
    ]);
    await upgradeCommand({});
    expect(childProcessMock.execFile.mock.calls[0][0]).toBe("unzip");
  });
});
