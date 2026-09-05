import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";

const fsState = vi.hoisted(() => ({
  existing: new Set<string>(),
  written: new Map<string, string>(),
}));

const mcpsMocks = vi.hoisted(() => ({
  buildElectronAppReleaseAssetUrl: vi.fn(() => "https://dl/MuggleAI.zip"),
  calculateFileChecksum: vi.fn(async () => "exec-checksum"),
  getChecksumForPlatform: vi.fn(() => "expected-archive-sum"),
  getDataDir: vi.fn(() => "/data"),
  getElectronAppChecksums: vi.fn(() => ({})),
  getElectronAppDir: vi.fn((v: string) => `/data/electron-app/${v}`),
  getElectronAppVersion: vi.fn(() => "1.0.5"),
  getElectronAppSignedFromVersion: vi.fn(() => "1.10.0"),
  getReleaseSignerIdentityUri: vi.fn(
    () => "https://github.com/multiplex-ai/muggle-ai-teaching-service/.github/workflows/release-electron-app-reusable.yml@refs/heads/master",
  ),
  getPlatformKey: vi.fn(() => "win32-x64"),
  isElectronAppInstalled: vi.fn(() => false),
  isFirstRun: vi.fn(() => false),
  reconcileProjectPreferences: vi.fn(() => ({
    outcome: "noAction",
    projectFilePath: "/repo/.muggle-ai/preferences.json",
    shadowedKeys: [],
  })),
  verifyFileChecksum: vi.fn(async () => ({ valid: true, expected: "e", actual: "e" })),
  writePreferences: vi.fn(),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

// Only the signature check is stubbed; resolveIntegrityPolicy stays real because the
// checksum's advisory-vs-required behaviour is exactly what these tests exercise.
const releaseIntegrityMocks = vi.hoisted(() => ({
  verifyReleaseSignature: vi.fn(async () => ({ valid: false, reason: "no signature bundle" })),
}));

vi.mock("../../../scripts/release-integrity/index.mjs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    verifyReleaseSignature: releaseIntegrityMocks.verifyReleaseSignature,
  };
});

const childProcessMock = vi.hoisted(() => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(null)),
}));

const streamMock = vi.hoisted(() => ({ pipeline: vi.fn(async () => undefined) }));

const osState = vi.hoisted(() => ({ platform: "win32", arch: "x64", home: "/home/u" }));

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return {
    ...actual,
    platform: vi.fn(() => osState.platform),
    arch: vi.fn(() => osState.arch),
    homedir: vi.fn(() => osState.home),
  };
});

vi.mock("fs", () => ({
  existsSync: vi.fn((p: string) => fsState.existing.has(p)),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  readFileSync: vi.fn(() => "{}"),
  writeFileSync: vi.fn((p: string, c: string) => {
    fsState.written.set(p, c);
  }),
  createWriteStream: vi.fn(() => ({ kind: "ws" })),
}));

vi.mock("child_process", () => childProcessMock);
vi.mock("stream/promises", () => streamMock);
vi.mock("../../../packages/mcps/src/index.js", () => ({
  ...mcpsMocks,
  DEFAULT_PREFERENCES: { autoLogin: "ask" },
  PREFERENCES_FILE_NAME: "preferences.json",
  ProjectPreferencesReconcileOutcome: {
    NoAction: "noAction",
    CopiedToGlobal: "copiedToGlobal",
    KeysShadowed: "keysShadowed",
  },
}));

import { setupCommand } from "../../cli/setup.js";

const VERSION_DIR = "/data/electron-app/1.0.5";
const EXE_PATH = join(VERSION_DIR, "MuggleAI.exe");
const META_PATH = join(VERSION_DIR, ".install-metadata.json");

function fetchOk(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      body: { kind: "body" },
    })),
  );
}

describe("setupCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fsState.existing.clear();
    fsState.written.clear();
    osState.platform = "win32";
    osState.arch = "x64";
    osState.home = "/home/u";
    mcpsMocks.isElectronAppInstalled.mockReturnValue(false);
    mcpsMocks.isFirstRun.mockReturnValue(false);
    mcpsMocks.reconcileProjectPreferences.mockReturnValue({
      outcome: "noAction",
      projectFilePath: "/repo/.muggle-ai/preferences.json",
      shadowedKeys: [],
    });
    mcpsMocks.verifyFileChecksum.mockResolvedValue({ valid: true, expected: "e", actual: "e" });
    mcpsMocks.getChecksumForPlatform.mockReturnValue("expected-archive-sum");
    mcpsMocks.getElectronAppVersion.mockReturnValue("1.0.5");
    childProcessMock.execFile.mockImplementation((_c, _a, cb) => cb(null));
    releaseIntegrityMocks.verifyReleaseSignature.mockResolvedValue({
      valid: false,
      reason: "no signature bundle",
    });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((): never => undefined as never));
    fetchOk();
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    warnSpy.mockRestore();
    exitSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("short-circuits when already installed and not forced", async () => {
    mcpsMocks.isElectronAppInstalled.mockReturnValue(true);
    await setupCommand({});
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("already installed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("writes default preferences on first run", async () => {
    mcpsMocks.isFirstRun.mockReturnValue(true);
    // executable shows up after extraction so the success path completes
    fsState.existing.add(EXE_PATH);
    await setupCommand({});
    expect(mcpsMocks.writePreferences).toHaveBeenCalledWith({ autoLogin: "ask" });
  });

  it("reports a legacy project preferences file copied forward, and leaves it unseeded", async () => {
    mcpsMocks.reconcileProjectPreferences.mockReturnValue({
      outcome: "copiedToGlobal",
      projectFilePath: "/repo/.muggle-ai/preferences.json",
      shadowedKeys: [],
    });
    fsState.existing.add(EXE_PATH);

    await setupCommand({});

    // The copy-forward already created the global file, so isFirstRun is false
    // and the defaults seed must not overwrite what was migrated.
    expect(mcpsMocks.writePreferences).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("/repo/.muggle-ai/preferences.json");
  });

  it("downloads, verifies checksum, extracts, and writes metadata on success", async () => {
    fsState.existing.add(EXE_PATH);
    await setupCommand({ force: true });

    expect(fetch).toHaveBeenCalledWith("https://dl/MuggleAI.zip");
    expect(streamMock.pipeline).toHaveBeenCalledOnce();
    expect(childProcessMock.execFile).toHaveBeenCalled();
    expect(fsState.written.has(META_PATH)).toBe(true);
    expect(JSON.parse(fsState.written.get(META_PATH) ?? "{}").executableChecksum).toBe("exec-checksum");
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Checksum verified");
  });

  it("refuses to install when neither a signature nor a checksum can verify the download", async () => {
    mcpsMocks.getChecksumForPlatform.mockReturnValue("");
    await setupCommand({ force: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(childProcessMock.execFile).not.toHaveBeenCalled();
  });

  it("refuses a release at the signed-from version whose signature does not verify", async () => {
    mcpsMocks.getElectronAppVersion.mockReturnValue("1.10.0");
    await setupCommand({ force: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(childProcessMock.execFile).not.toHaveBeenCalled();
  });

  it("exits 1 when checksum verification fails", async () => {
    mcpsMocks.verifyFileChecksum.mockResolvedValue({ valid: false, expected: "a", actual: "b" });
    await setupCommand({ force: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("Failed to download");
  });

  it("installs a signature-verified release even when its pinned checksum is stale", async () => {
    // At/above the signed-from version the signature is the required control, so a pin
    // left behind by an earlier electron-app version must not block the install.
    const signedVersion = "1.10.3";
    mcpsMocks.getElectronAppVersion.mockReturnValue(signedVersion);
    releaseIntegrityMocks.verifyReleaseSignature.mockResolvedValue({ valid: true, reason: "" });
    mcpsMocks.verifyFileChecksum.mockResolvedValue({
      valid: false,
      expected: "stale-pin-from-an-older-release",
      actual: "hash-of-what-was-actually-published",
    });
    fsState.existing.add(join(`/data/electron-app/${signedVersion}`, "MuggleAI.exe"));

    await setupCommand({ force: true });

    expect(exitSpy).not.toHaveBeenCalledWith(1);
    expect(childProcessMock.execFile).toHaveBeenCalled();

    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warned).toContain("stale");
    expect(warned).toContain("stale-pin-from-an-older-release");
    expect(warned).toContain("hash-of-what-was-actually-published");
    // The scary wording belongs only to a genuinely unverifiable download.
    expect(warned).not.toContain("tampered with");
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("Checksum verified");
  });

  it("exits 1 when the extracted executable is missing", async () => {
    // executable never added to fsState -> extraction verification fails
    await setupCommand({ force: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("exits 1 when the HTTP download is not ok across all retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, statusText: "Unavailable", body: null })),
    );
    vi.useFakeTimers();
    const done = setupCommand({ force: true });
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("upserts a fresh cursor mcp config when none exists", async () => {
    fsState.existing.add(EXE_PATH);
    await setupCommand({ force: true });
    const written = [...fsState.written.entries()].find(([p]) => p.endsWith("mcp.json"));
    expect(written).toBeDefined();
    expect(JSON.parse(written![1]).mcpServers.muggle).toEqual({ command: "muggle", args: ["serve"] });
  });

  it("merges into an existing cursor config preserving other servers", async () => {
    const cursorPath = join("/home/u", ".cursor", "mcp.json");
    fsState.existing.add(cursorPath);
    fsState.existing.add(EXE_PATH);
    vi.mocked((await import("fs")).readFileSync).mockReturnValueOnce(
      JSON.stringify({ mcpServers: { other: { command: "x" } } }) as never,
    );
    await setupCommand({ force: true });
    const written = [...fsState.written.entries()].find(([p]) => p.endsWith("mcp.json"));
    const parsed = JSON.parse(written![1]);
    expect(parsed.mcpServers.other).toEqual({ command: "x" });
    expect(parsed.mcpServers.muggle).toEqual({ command: "muggle", args: ["serve"] });
  });

  it("skips the cursor upsert when the existing config is an array", async () => {
    const cursorPath = join("/home/u", ".cursor", "mcp.json");
    fsState.existing.add(cursorPath);
    fsState.existing.add(EXE_PATH);
    vi.mocked((await import("fs")).readFileSync).mockReturnValueOnce("[]" as never);
    await setupCommand({ force: true });
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("unexpected shape");
  });

  it("skips the cursor upsert when the existing config is invalid JSON", async () => {
    const cursorPath = join("/home/u", ".cursor", "mcp.json");
    fsState.existing.add(cursorPath);
    fsState.existing.add(EXE_PATH);
    vi.mocked((await import("fs")).readFileSync).mockReturnValueOnce("{ broken" as never);
    await setupCommand({ force: true });
    expect(logSpy.mock.calls.map((c) => String(c[0])).join("\n")).toContain("invalid JSON");
  });

  it("uses the unzip extractor and darwin paths on macOS", async () => {
    osState.platform = "darwin";
    osState.arch = "arm64";
    const darwinExe = join("/data/electron-app/1.0.5", "MuggleAI.app", "Contents", "MacOS", "MuggleAI");
    fsState.existing.add(darwinExe);
    await setupCommand({ force: true });
    expect(mcpsMocks.buildElectronAppReleaseAssetUrl).toHaveBeenCalled();
    const [cmd] = childProcessMock.execFile.mock.calls[0];
    expect(cmd).toBe("unzip");
  });

  it("exits 1 when extraction itself fails", async () => {
    fsState.existing.add(EXE_PATH);
    childProcessMock.execFile.mockImplementation((_c, _a, cb) => cb(new Error("unzip blew up")));
    await setupCommand({ force: true });
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
