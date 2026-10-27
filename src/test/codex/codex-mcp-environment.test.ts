import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { FORWARDABLE_LLM_ENV_NAMES } from "../../../packages/mcps/src/shared/llm-env-constants.js";

// Codex starts a stdio MCP server with a fixed handful of variables, then the
// names its config lists in env_vars and the pairs it sets in env — nothing else
// of the user's environment arrives. A variable the server reads that none of
// those carry is silently unset under Codex: MUGGLE_TELEMETRY_DISABLED was, so a
// user's telemetry opt-out stopped applying. This pins every runtime read to
// what Codex actually forwards.
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CODEX_MCP_CONFIG = join(REPO_ROOT, "plugin", ".codex-mcp.json");
const TELEMETRY_ENV_CONSTANTS = join(REPO_ROOT, "node_modules", "@muggleai", "telemetry", "dist", "constants", "env.js");

// Codex 0.163.0, codex-rs/rmcp-client/src/utils.rs DEFAULT_ENV_VARS (Unix).
const CODEX_MCP_DEFAULT_ENV = [
  "HOME", "LOGNAME", "PATH", "SHELL", "USER", "__CF_USER_TEXT_ENCODING", "LANG", "LC_ALL", "TERM", "TMPDIR", "TZ",
];
// codex-rs/network-proxy/src/certs.rs CUSTOM_CA_ENV_KEYS, forwarded to every MCP server.
const CODEX_MCP_CA_ENV = [
  "CODEX_CA_CERTIFICATE", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "NODE_EXTRA_CA_CERTS",
  "GIT_SSL_CAINFO", "CARGO_HTTP_CAINFO", "PIP_CERT", "BUNDLE_SSL_CA_CERT", "npm_config_cafile", "NPM_CONFIG_CAFILE",
];

/** What the server reads but deliberately leaves behind under Codex, and why. */
const NOT_FORWARDED: Record<string, string> = {
  CLAUDE_CODE: "names another host; under Codex the MUGGLE_MCP_HOST stamp decides",
  CLAUDECODE: "names another host; under Codex the MUGGLE_MCP_HOST stamp decides",
  CLAUDE_CODE_SSE_PORT: "names another host; under Codex the MUGGLE_MCP_HOST stamp decides",
  CURSOR_TRACE_ID: "names another host; under Codex the MUGGLE_MCP_HOST stamp decides",
  CURSOR_MCP: "names another host; under Codex the MUGGLE_MCP_HOST stamp decides",
  WINDSURF_MCP: "names another host; under Codex the MUGGLE_MCP_HOST stamp decides",
  WINDSURF: "names another host; under Codex the MUGGLE_MCP_HOST stamp decides",
  CODEIUM_API_KEY: "names another host; under Codex the MUGGLE_MCP_HOST stamp decides",
  CODEX: "a hand-written config's host signal; the plugin stamps MUGGLE_MCP_HOST instead",
  OPENAI_CODEX: "a hand-written config's host signal; the plugin stamps MUGGLE_MCP_HOST instead",
  APPLICATIONINSIGHTS_CONNECTION_STRING: "inlined into the published build by tsup define, never read from the user",
  VITE_APPLICATIONINSIGHTS_CONNECTION_STRING: "read only by browser builds of the telemetry client",
  MUGGLE_STACK_SERVICE_STOPS: "set only by the test config, so no test run stops a real process; a user never sets it",
};

// The code that runs inside the process `muggle serve` starts.
const SERVER_SOURCES = ["packages/mcps/src", "src/server", "src/cli/serve.ts"];

const ENV_NAME = "[A-Z_][A-Z0-9_]*";
const LITERAL_READ = new RegExp(`\\benv(?:\\.(${ENV_NAME})\\b|\\[\\s*["'](${ENV_NAME})["']\\s*\\])`, "g");
const IDENTIFIER_READ = /\benv\[\s*([A-Za-z_$][\w$]*)\s*\]/g;
const STRING_CONSTANT = new RegExp(`\\bconst\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*["'](${ENV_NAME})["']`, "g");

function sourceFiles(relativePath: string): string[] {
  const absolute = join(REPO_ROOT, relativePath);
  if (statSync(absolute).isFile()) return [absolute];
  return readdirSync(absolute, { recursive: true, encoding: "utf-8" })
    .filter((entry) => entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !/(^|[\\/])test[\\/]/.test(entry))
    .map((entry) => join(absolute, entry));
}

/**
 * Every variable name the server's own code reads: `env.NAME`, `env["NAME"]`,
 * and `env[CONSTANT]` where CONSTANT is a string constant declared in the same
 * tree. A name computed at run time is invisible to this, which is why the
 * forwarded LLM list is checked by import instead.
 */
function namesReadByServer(): Set<string> {
  const sources = SERVER_SOURCES.flatMap(sourceFiles).map((file) => readFileSync(file, "utf-8"));
  const constants = new Map<string, string>();
  for (const source of sources) {
    for (const [, identifier, value] of source.matchAll(STRING_CONSTANT)) constants.set(identifier, value);
  }
  const names = new Set<string>();
  for (const source of sources) {
    for (const [, dotted, quoted] of source.matchAll(LITERAL_READ)) names.add(dotted ?? quoted);
    for (const [, identifier] of source.matchAll(IDENTIFIER_READ)) {
      const value = constants.get(identifier);
      if (value) names.add(value);
    }
  }
  return names;
}

/** The variables the bundled telemetry client reads, from its own constants module. */
function namesReadByTelemetry(): string[] {
  const constants = readFileSync(TELEMETRY_ENV_CONSTANTS, "utf-8");
  return [...constants.matchAll(new RegExp(`=\\s*["'](${ENV_NAME})["']`, "g"))].map(([, name]) => name);
}

function codexForwarded(): Set<string> {
  const server = (
    JSON.parse(readFileSync(CODEX_MCP_CONFIG, "utf-8")) as {
      mcpServers: Record<string, { env?: Record<string, string>; env_vars?: string[] }>;
    }
  ).mcpServers.muggle;
  return new Set([
    ...CODEX_MCP_DEFAULT_ENV,
    ...CODEX_MCP_CA_ENV,
    ...(server.env_vars ?? []),
    ...Object.keys(server.env ?? {}),
  ]);
}

describe("the environment Codex hands the muggle MCP server", () => {
  const forwarded = codexForwarded();
  const serverReads = namesReadByServer();
  const telemetryReads = namesReadByTelemetry();

  it("finds the reads it is meant to police", () => {
    // A scan that silently matched nothing would pass everything below.
    expect(serverReads.has("ELECTRON_APP_PATH")).toBe(true);
    expect(serverReads.has("MUGGLE_MCP_PROMPT_SERVICE_TARGET")).toBe(true);
    expect(telemetryReads).toContain("MUGGLE_TELEMETRY_DISABLED");
  });

  it("carries every variable the server reads, or says why not", () => {
    const dropped = [...serverReads].filter((name) => !forwarded.has(name) && !(name in NOT_FORWARDED));
    expect(dropped).toEqual([]);
  });

  it("carries every variable the telemetry client reads, so an opt-out still applies", () => {
    const dropped = telemetryReads.filter((name) => !forwarded.has(name) && !(name in NOT_FORWARDED));
    expect(dropped).toEqual([]);
  });

  it("carries every LLM override the spawned Studio reads", () => {
    expect(FORWARDABLE_LLM_ENV_NAMES.filter((name) => !forwarded.has(name))).toEqual([]);
  });

  it("names no exemption for a variable nothing reads any more", () => {
    const read = new Set([...serverReads, ...telemetryReads]);
    expect(Object.keys(NOT_FORWARDED).filter((name) => !read.has(name))).toEqual([]);
  });
});
