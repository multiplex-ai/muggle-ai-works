import { spawn, spawnSync, type SpawnSyncReturns } from "child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";
import { createInterface } from "readline";
import { fileURLToPath } from "url";
import type { MockResponsesServer } from "./mockResponsesServer.js";
import type { AppServerResponse, AppServerSession, CodexExecResult, ProcessResult, ScriptedTurn } from "./types.js";

// A throwaway Codex install with the plugin added from this checkout the way a
// user adds it, pointed at a scripted model. Everything Codex, the hooks and
// the MCP server write lands in temp dirs: CODEX_HOME for Codex, HOME for the
// guardrail state, and a workspace whose node_modules makes the plugin's own
// `npx -y @muggleai/works serve` start this checkout's build, offline.

export const REPO_ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

/** The Codex CLI under test — a native binary or the npm package's bin/codex.js. Unset, the live suites skip. */
export const CODEX_BIN = process.env.CODEX_BIN;

export const PLUGIN_ID = "muggle@muggle-works";

/** A model slug no bundled catalog entry prefix-matches, described by the catalog the session writes. */
const MOCK_MODEL = "mock-model";

/** The PR url the fake `gh` prints for `gh pr create`. */
export const FAKE_PR_URL = "https://github.com/acme/shop/pull/7";

const CODEX_RUN_TIMEOUT_MS = 180_000;

// Variables that would authenticate Codex against a real backend instead of the mock.
const CREDENTIAL_ENV = ["CODEX_API_KEY", "CODEX_ACCESS_TOKEN", "OPENAI_API_KEY"];

export function codexCommand(args: string[]): { program: string; argv: string[] } {
  if (!CODEX_BIN) throw new Error("CODEX_BIN is not set");
  return /\.m?js$/.test(CODEX_BIN)
    ? { program: process.execPath, argv: [CODEX_BIN, ...args] }
    : { program: CODEX_BIN, argv: args };
}

function writeExecutable(path: string, body: string): void {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

/** One isolated Codex home with the muggle plugin installed, and the dirs around it. */
export class CodexSession {
  readonly codexHome = mkdtempSync(join(tmpdir(), "codex-live-home-"));
  readonly home = mkdtempSync(join(tmpdir(), "codex-live-user-"));
  readonly workspace = mkdtempSync(join(tmpdir(), "codex-live-work-"));
  readonly fakeBin = mkdtempSync(join(tmpdir(), "codex-live-bin-"));

  constructor(private readonly model: MockResponsesServer) {}

  /** Install the plugin from this checkout — `installPlugin`, by default the user's two commands — and point Codex at the scripted model. */
  prepare(installPlugin: () => void = () => this.installPlugin()): void {
    this.prepareWorkspace();
    this.prepareHome();
    installPlugin();
    this.writeModelConfig();
  }

  /** Add this checkout as a marketplace and install the plugin from it, as a user does. */
  installPlugin(): void {
    this.runCodex(["plugin", "marketplace", "add", REPO_ROOT]);
    this.runCodex(["plugin", "add", PLUGIN_ID]);
  }

  /** The environment every Codex process here runs with — inherited by its hooks and MCP servers. */
  env(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of CREDENTIAL_ENV) delete env[name];
    return {
      ...env,
      CODEX_HOME: this.codexHome,
      HOME: this.home,
      USERPROFILE: this.home,
      PATH: `${this.fakeBin}${delimiter}${process.env.PATH ?? ""}`,
      // Forwarded to the MCP server through the plugin's env_vars; the run must never phone home.
      MUGGLE_TELEMETRY_DISABLED: "1",
      MUGGLE_GUARDRAIL_GH_CALLS: "off",
    };
  }

  /** Run a Codex subcommand to completion; throws with its output when it fails. */
  runCodex(args: string[]): SpawnSyncReturns<string> {
    const { program, argv } = codexCommand(args);
    const run = spawnSync(program, argv, {
      cwd: this.workspace,
      env: this.env(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: CODEX_RUN_TIMEOUT_MS,
    });
    if (run.status !== 0) {
      throw new Error(`codex ${args.join(" ")} exited ${run.status}\n${run.stdout}\n${run.stderr}`);
    }
    return run;
  }

  /**
   * One non-interactive turn against the scripted model. Hook trust is
   * bypassed — a test cannot answer Codex's trust prompt — and the sandbox is
   * off so a runner without user namespaces still executes the commands.
   */
  async exec(prompt: string, script: ScriptedTurn): Promise<CodexExecResult> {
    this.model.useScript(script);
    const { program, argv } = codexCommand([
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "--dangerously-bypass-hook-trust",
      "--sandbox",
      "danger-full-access",
      "--color",
      "never",
      prompt,
    ]);
    const run = await runToCompletion(program, argv, { cwd: this.workspace, env: this.env() });
    return { ...run, requests: [...this.model.requests] };
  }

  /**
   * Ask `codex app-server` each method in turn over stdio JSON-RPC, after the
   * initialize handshake. Its log comes back too, MCP startup included, for a
   * failure to explain itself.
   */
  async appServer(calls: Array<{ method: string; params: unknown }>): Promise<AppServerSession> {
    const { program, argv } = codexCommand(["app-server"]);
    const child = spawn(program, argv, {
      cwd: this.workspace,
      env: { ...this.env(), RUST_LOG: "warn,codex_rmcp_client=info,codex_mcp=info" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let log = "";
    child.stderr.on("data", (chunk: Buffer) => (log += chunk.toString("utf-8")));
    const pending = new Map<number, (response: AppServerResponse) => void>();
    createInterface({ input: child.stdout }).on("line", (line) => {
      let message: AppServerResponse;
      try {
        message = JSON.parse(line) as AppServerResponse;
      } catch {
        return;
      }
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    let nextId = 0;
    const request = (method: string, params: unknown): Promise<AppServerResponse> =>
      new Promise((resolve) => {
        nextId += 1;
        pending.set(nextId, resolve);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: nextId, method: method, params: params })}\n`);
      });
    const timer = setTimeout(() => child.kill("SIGKILL"), CODEX_RUN_TIMEOUT_MS);
    try {
      await request("initialize", { clientInfo: { name: "muggle-codex-live", title: "muggle-codex-live", version: "0.0.0" } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "initialized" })}\n`);
      const responses: AppServerResponse[] = [];
      for (const call of calls) responses.push(await request(call.method, call.params));
      return { responses: responses, log: log };
    } finally {
      clearTimeout(timer);
      child.kill();
    }
  }

  // `npx -y @muggleai/works` resolves a package already in the cwd's
  // node_modules without touching the registry, so the plugin's unmodified MCP
  // command starts this checkout. Codex starts a server in the thread's cwd, or
  // in CODEX_HOME when no thread is open (app-server status calls), so both get
  // the package; otherwise npx quietly installs the published one instead.
  private prepareWorkspace(): void {
    linkCheckoutPackage(this.workspace);
    linkCheckoutPackage(this.codexHome);
    // The model's own `gh`: prints a PR url for `gh pr create`, nothing for anything else.
    const fakeGh = `process.stdout.write(process.argv[2] === "pr" && process.argv[3] === "create" ? "${FAKE_PR_URL}\\n" : "");\n`;
    writeFileSync(join(this.fakeBin, "fake-gh.mjs"), fakeGh);
    if (process.platform === "win32") {
      writeFileSync(join(this.fakeBin, "gh.cmd"), `@node "%~dp0fake-gh.mjs" %*\r\n`);
    } else {
      writeExecutable(join(this.fakeBin, "gh"), `#!/bin/sh\nexec node "${join(this.fakeBin, "fake-gh.mjs")}" "$@"\n`);
    }
  }

  // A fresh Electron check marker keeps the SessionStart hook from running
  // `muggle setup`, which would download the Electron runner. Offline npm makes
  // an `npx` that stopped resolving this checkout fail loudly rather than
  // quietly install the published package — and keeps the cache in the temp home.
  private prepareHome(): void {
    const marker = join(this.home, ".cache", "muggle");
    mkdirSync(marker, { recursive: true });
    writeFileSync(join(marker, "electron-app-checked"), "");
    writeFileSync(join(this.home, ".npmrc"), `offline=true\ncache=${join(this.home, ".npm-cache")}\n`);
  }

  // Top-level keys must precede the tables `codex plugin add` already wrote.
  private writeModelConfig(): void {
    const catalog = writeMockModelCatalog(this.codexHome);
    const configPath = join(this.codexHome, "config.toml");
    const installed = readFileSync(configPath, "utf-8");
    const topLevel = [
      `model = "${MOCK_MODEL}"`,
      `model_provider = "mock"`,
      `model_catalog_json = ${JSON.stringify(catalog)}`,
      `web_search = "disabled"`,
      // A login shell re-sorts PATH on macOS (path_helper), putting the runner's
      // real gh in front of the fake one; the hooks never run under one anyway.
      `allow_login_shell = false`,
    ].join("\n");
    const tables = [
      `[model_providers.mock]`,
      `name = "Scripted model"`,
      `base_url = ${JSON.stringify(this.model.baseUrl)}`,
      `wire_api = "responses"`,
      `supports_websockets = false`,
      `request_max_retries = 0`,
      `stream_max_retries = 0`,
      `stream_idle_timeout_ms = 60000`,
      ``,
      `[analytics]`,
      `enabled = false`,
    ].join("\n");
    writeFileSync(configPath, `${topLevel}\n\n${installed}\n${tables}\n`);
  }
}

/** Describe the scripted model to Codex in `dir`; returns the catalog's path, for `model_catalog_json`. */
export function writeMockModelCatalog(dir: string): string {
  const catalog = join(dir, "mock-model-catalog.json");
  writeFileSync(
    catalog,
    JSON.stringify({
      models: [
        {
          slug: MOCK_MODEL,
          display_name: "Mock Model",
          supported_reasoning_levels: [],
          shell_type: "unified_exec",
          visibility: "list",
          supported_in_api: true,
          priority: 1,
          support_verbosity: false,
          truncation_policy: { mode: "bytes", limit: 10000 },
          experimental_supported_tools: [],
          // A bundled model's window, so the skills catalog gets a production-sized budget.
          context_window: 272000,
          supports_reasoning_summary_parameter: false,
          base_instructions: "You are a scripted test agent.",
        },
      ],
    }),
  );
  return catalog;
}

/** `-c key=value` overrides that point a Codex home at the scripted model, for a home this file did not set up. */
export function mockModelOverrides(model: MockResponsesServer, catalogPath: string): string[] {
  return [
    `model=${JSON.stringify(MOCK_MODEL)}`,
    `model_provider="mock"`,
    `model_catalog_json=${JSON.stringify(catalogPath)}`,
    `model_providers.mock.name="Scripted model"`,
    `model_providers.mock.base_url=${JSON.stringify(model.baseUrl)}`,
    `model_providers.mock.wire_api="responses"`,
    `model_providers.mock.supports_websockets=false`,
    `model_providers.mock.request_max_retries=0`,
    `model_providers.mock.stream_max_retries=0`,
  ];
}

/**
 * Run a process to its exit without blocking the event loop — the scripted
 * model answers on it, so a synchronous spawn of anything that calls Codex
 * would wait on a reply it is itself holding up.
 */
export async function runToCompletion(
  program: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<ProcessResult> {
  const child = spawn(program, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf-8")));
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")));
  const timer = setTimeout(() => child.kill("SIGKILL"), CODEX_RUN_TIMEOUT_MS);
  const status = await new Promise<number | null>((resolve) => child.on("close", resolve));
  clearTimeout(timer);
  return { status: status, stdout: stdout, stderr: stderr };
}

/** Make `dir` a project with this checkout installed as @muggleai/works; a Windows junction needs no privilege. */
function linkCheckoutPackage(dir: string): void {
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "codex-live-fixture", private: true }));
  const scope = join(dir, "node_modules", "@muggleai");
  const bin = join(dir, "node_modules", ".bin");
  mkdirSync(scope, { recursive: true });
  mkdirSync(bin, { recursive: true });
  symlinkSync(REPO_ROOT, join(scope, "works"), process.platform === "win32" ? "junction" : "dir");
  const cli = join(REPO_ROOT, "bin", "muggle.js");
  if (process.platform === "win32") {
    writeFileSync(join(bin, "muggle.cmd"), `@node "${cli}" %*\r\n`);
  } else {
    writeExecutable(join(bin, "muggle"), `#!/bin/sh\nexec node "${cli}" "$@"\n`);
  }
}

/** Hook outcomes Codex prints to stderr in its human output mode, e.g. `hook: Stop Blocked`. */
export function hookOutcomes(stderr: string): string[] {
  return [...stderr.matchAll(/^hook: (\w+) (\w+)/gm)].map(([, event, outcome]) => `${event} ${outcome}`);
}
