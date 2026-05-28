import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "path";

const fsState = vi.hoisted(() => ({
  existing: new Set<string>(),
  files: new Map<string, string>(),
  dirEntries: new Map<string, string[]>(),
  isFile: new Set<string>(),
  statThrows: new Set<string>(),
}));

const platformState = vi.hoisted(() => ({ value: "win32", home: "/home/u" }));

const mcpsMocks = vi.hoisted(() => ({
  getAuthService: vi.fn(() => ({ getAuthStatus: vi.fn(() => ({ authenticated: true, email: "u@e.com" })) })),
  getBundledElectronAppVersion: vi.fn(() => "1.0.4"),
  getConfig: vi.fn(() => ({
    e2e: { promptServiceBaseUrl: "https://prompt" },
    localQa: { webServiceUrl: "https://web" },
  })),
  getCredentialsFilePath: vi.fn(() => "/creds.json"),
  getDataDir: vi.fn(() => "/data"),
  getElectronAppDir: vi.fn((v: string) => `/data/electron-app/${v}`),
  getElectronAppVersion: vi.fn(() => "1.0.5"),
  getElectronAppVersionSource: vi.fn(() => "bundled"),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  hasApiKey: vi.fn(() => true),
}));

const fsImpl = vi.hoisted(() => ({
  existsSync: vi.fn((p: string) => fsState.existing.has(p)),
  readFileSync: vi.fn((p: string) => fsState.files.get(p) ?? "{}"),
  readdirSync: vi.fn((p: string) => fsState.dirEntries.get(p) ?? []),
  statSync: vi.fn((p: string) => {
    if (fsState.statThrows.has(p)) throw new Error("stat failed");
    return { isFile: () => fsState.isFile.has(p) };
  }),
}));

vi.mock("fs", () => fsImpl);
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>();
  return { ...actual, platform: vi.fn(() => platformState.value), homedir: vi.fn(() => platformState.home) };
});
vi.mock("../../../packages/mcps/src/index.js", () => mcpsMocks);

import { doctorCommand } from "../../cli/doctor.js";

const VERSION_DIR = "/data/electron-app/1.0.5";
const EXE = join(VERSION_DIR, "MuggleAI.exe");
const META = join(VERSION_DIR, ".install-metadata.json");
const CURSOR_MCP = join("/home/u", ".cursor", "mcp.json");

function output(logSpy: ReturnType<typeof vi.spyOn>): string {
  return logSpy.mock.calls.map((c) => String(c[0])).join("\n");
}

describe("doctorCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    fsState.existing.clear();
    fsState.files.clear();
    fsState.dirEntries.clear();
    fsState.isFile.clear();
    fsState.statThrows.clear();
    platformState.value = "win32";
    platformState.home = "/home/u";
    mcpsMocks.getElectronAppVersionSource.mockReturnValue("bundled");
    mcpsMocks.getAuthService.mockReturnValue({
      getAuthStatus: vi.fn(() => ({ authenticated: true, email: "u@e.com" })),
    } as never);
    mcpsMocks.hasApiKey.mockReturnValue(true);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => logSpy.mockRestore());

  it("reports all green for a valid installation and config", async () => {
    fsState.existing.add("/data");
    fsState.existing.add(VERSION_DIR);
    fsState.existing.add(EXE);
    fsState.existing.add(META);
    fsState.existing.add("/creds.json");
    fsState.existing.add(CURSOR_MCP);
    fsState.isFile.add(EXE);
    fsState.files.set(
      CURSOR_MCP,
      JSON.stringify({ mcpServers: { muggle: { command: "muggle", args: ["serve"] } } }),
    );

    await doctorCommand();

    const out = output(logSpy);
    expect(out).toContain("Installed (v1.0.5)");
    expect(out).toContain("Authenticated as u@e.com");
    expect(out).toContain("All checks passed");
  });

  it("flags a missing executable and counts issues", async () => {
    fsState.existing.add(VERSION_DIR);
    await doctorCommand();
    const out = output(logSpy);
    expect(out).toContain("Not installed");
    expect(out).toContain("Executable not found");
    expect(out).toMatch(/issue\(s\) found/);
  });

  it("detects a partial archive and suggests --force", async () => {
    fsState.existing.add(VERSION_DIR);
    fsState.dirEntries.set(VERSION_DIR, ["MuggleAI-win32-x64.zip"]);
    await doctorCommand();
    const out = output(logSpy);
    expect(out).toContain("Download incomplete");
    expect(out).toContain("--force");
  });

  it("flags an executable path that is not a regular file", async () => {
    fsState.existing.add(VERSION_DIR);
    fsState.existing.add(EXE);
    await doctorCommand();
    expect(output(logSpy)).toContain("is not a file");
  });

  it("flags a broken symlink when statSync throws", async () => {
    fsState.existing.add(VERSION_DIR);
    fsState.existing.add(EXE);
    fsState.statThrows.add(EXE);
    await doctorCommand();
    expect(output(logSpy)).toContain("broken symlink");
  });

  it("notes missing metadata while still valid", async () => {
    fsState.existing.add(VERSION_DIR);
    fsState.existing.add(EXE);
    fsState.isFile.add(EXE);
    await doctorCommand();
    expect(output(logSpy)).toContain("[missing metadata]");
  });

  it("annotates the version source for env and override", async () => {
    fsState.existing.add(VERSION_DIR);
    fsState.existing.add(EXE);
    fsState.existing.add(META);
    fsState.isFile.add(EXE);

    mcpsMocks.getElectronAppVersionSource.mockReturnValue("env");
    await doctorCommand();
    expect(output(logSpy)).toContain("from ELECTRON_APP_VERSION env");

    logSpy.mockClear();
    mcpsMocks.getElectronAppVersionSource.mockReturnValue("override");
    await doctorCommand();
    expect(output(logSpy)).toContain("overridden from bundled");
  });

  it("reports not-authenticated and missing api key", async () => {
    mcpsMocks.getAuthService.mockReturnValue({
      getAuthStatus: vi.fn(() => ({ authenticated: false })),
    } as never);
    mcpsMocks.hasApiKey.mockReturnValue(false);
    await doctorCommand();
    const out = output(logSpy);
    expect(out).toContain("Not authenticated");
    expect(out).toContain("No API key stored");
  });

  it("reports a missing cursor mcp config", async () => {
    await doctorCommand();
    expect(output(logSpy)).toContain("Missing at");
  });

  it("reports invalid cursor config JSON", async () => {
    fsState.existing.add(CURSOR_MCP);
    fsState.files.set(CURSOR_MCP, "{ broken");
    await doctorCommand();
    expect(output(logSpy)).toContain("Invalid JSON or schema");
  });

  it("reports a cursor config missing the serve argument", async () => {
    fsState.existing.add(CURSOR_MCP);
    fsState.files.set(CURSOR_MCP, JSON.stringify({ mcpServers: { muggle: { command: "muggle", args: ["x"] } } }));
    await doctorCommand();
    expect(output(logSpy)).toContain("does not include 'serve'");
  });

  it("reports a cursor config whose mcpServers map lacks muggle", async () => {
    fsState.existing.add(CURSOR_MCP);
    fsState.files.set(CURSOR_MCP, JSON.stringify({ mcpServers: {} }));
    await doctorCommand();
    expect(output(logSpy)).toContain("Missing mcpServers.muggle entry");
  });

  it("validates a node-command config whose args[0] file is missing", async () => {
    fsState.existing.add(CURSOR_MCP);
    fsState.files.set(
      CURSOR_MCP,
      JSON.stringify({ mcpServers: { muggle: { command: "node", args: ["serve", "/missing.js"] } } }),
    );
    await doctorCommand();
    expect(output(logSpy)).toContain("does not exist: serve");
  });

  it("throws for an unsupported platform when resolving the executable path", async () => {
    platformState.value = "sunos";
    fsState.existing.add(VERSION_DIR);
    await expect(doctorCommand()).rejects.toThrow(/Unsupported platform/);
  });
});
