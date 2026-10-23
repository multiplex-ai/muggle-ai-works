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
  getActiveRuntimeTarget: vi.fn(() => "production"),
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
vi.mock("../../../packages/mcps/src/index.js", async () => ({
  ...mcpsMocks,
  ...(await vi.importActual<typeof import("../../../packages/mcps/src/shared/electron-app-executable.js")>(
    "../../../packages/mcps/src/shared/electron-app-executable.js",
  )),
}));

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

  it("reports a Linux install as installed when its electron-builder executable is present", async () => {
    platformState.value = "linux";
    const linuxExe = join(VERSION_DIR, "muggle-ai-studio");
    fsState.existing.add(VERSION_DIR);
    fsState.existing.add(linuxExe);
    fsState.existing.add(META);
    fsState.isFile.add(linuxExe);

    await doctorCommand();

    expect(output(logSpy)).toContain("Installed (v1.0.5)");
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

  describe("Codex integration", () => {
    const CODEX_HOME = join("/home/u", ".codex");
    const CODEX_CONFIG = join(CODEX_HOME, "config.toml");
    const CODEX_PLUGIN_CACHE = join(CODEX_HOME, "plugins", "cache", "muggle-works", "muggle");
    const PLUGIN_TABLE = '[plugins."muggle@muggle-works"]\nenabled = true\n';
    const originalCodexHome = process.env.CODEX_HOME;

    beforeEach(() => {
      delete process.env.CODEX_HOME;
    });

    afterEach(() => {
      if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = originalCodexHome;
    });

    function codexLine(): string {
      return output(logSpy)
        .split("\n")
        .filter((line, index, lines) => line.includes("Codex Integration") || lines[index - 1]?.includes("Codex Integration"))
        .join("\n");
    }

    function withCodexConfig(toml: string): void {
      fsState.existing.add(CODEX_HOME);
      fsState.existing.add(CODEX_CONFIG);
      fsState.files.set(CODEX_CONFIG, toml);
    }

    it("skips the check on a machine without Codex", async () => {
      await doctorCommand();
      expect(codexLine()).toContain("Codex not detected (skipped)");
    });

    it("passes when the plugin is installed and enabled", async () => {
      withCodexConfig(PLUGIN_TABLE);
      fsState.existing.add(CODEX_PLUGIN_CACHE);
      await doctorCommand();
      expect(codexLine()).toContain("Plugin muggle@muggle-works installed and enabled");
    });

    it("flags a plugin that is installed but disabled", async () => {
      withCodexConfig('[plugins."muggle@muggle-works"]\nenabled = false\n');
      fsState.existing.add(CODEX_PLUGIN_CACHE);
      await doctorCommand();
      expect(codexLine()).toContain("installed but disabled");
    });

    it("notes a hand-registered server that duplicates the plugin's", async () => {
      withCodexConfig(`${PLUGIN_TABLE}\n[mcp_servers.muggle]\ncommand = "muggle"\n`);
      fsState.existing.add(CODEX_PLUGIN_CACHE);
      await doctorCommand();
      expect(codexLine()).toContain("Codex keeps only one server by that name");
    });

    // Codex's default tool timeout is 60s; a local run takes minutes.
    it("flags a hand-registered server that keeps Codex's default tool timeout", async () => {
      withCodexConfig('[mcp_servers.muggle]\ncommand = "muggle"\nargs = ["serve"]\n');
      await doctorCommand();
      expect(codexLine()).toContain("tool_timeout_sec unset (Codex default: 60)");
      expect(codexLine()).toContain("tool_timeout_sec = 1800");
    });

    it("flags a hand-registered tool timeout too short for a local run", async () => {
      withCodexConfig('[mcp_servers."muggle"]\ncommand = "muggle"\ntool_timeout_sec = 300\n');
      await doctorCommand();
      expect(codexLine()).toContain("has tool_timeout_sec 300");
    });

    it("passes a hand-registered server whose timeout outlasts a local run", async () => {
      withCodexConfig('[mcp_servers.muggle]\ncommand = "muggle"\ntool_timeout_sec = 1800\n\n[mcp_servers.muggle.env]\nMUGGLE_MCP_HOST = "codex"\n');
      await doctorCommand();
      expect(codexLine()).toContain("MCP server registered in");
    });

    it("tells a Codex user with nothing registered how to install the plugin", async () => {
      fsState.existing.add(CODEX_HOME);
      await doctorCommand();
      expect(codexLine()).toContain("Muggle is not registered with it");
      expect(codexLine()).toContain("codex plugin add muggle@muggle-works");
    });

    it("reads the Codex home from CODEX_HOME", async () => {
      process.env.CODEX_HOME = "/custom/codex";
      fsState.existing.add("/custom/codex");
      await doctorCommand();
      expect(codexLine()).toContain("Codex found at /custom/codex");
    });
  });

  it("throws for an unsupported platform when resolving the executable path", async () => {
    platformState.value = "sunos";
    fsState.existing.add(VERSION_DIR);
    await expect(doctorCommand()).rejects.toThrow(/Unsupported platform/);
  });
});
