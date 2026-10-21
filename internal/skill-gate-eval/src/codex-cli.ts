/**
 * What both evals' Codex harnesses (this package's codex-harness.ts and
 * agent-gate-eval's) need from the Codex CLI: running a `codex exec` turn,
 * reading its `--json` events, and the Codex home they write.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CODEX_EVAL_HOME_MARKER,
  CODEX_TURN_TIMEOUT_MS,
  MOCK_STDIO_SERVER_NAME,
} from "./constants.js";
import { mockToolSpecs } from "./mock-tools.js";
import type { CodexTurnOutput, Fixtures } from "./types.js";

const MOCK_STDIO_SERVER = fileURLToPath(new URL("./mock-mcp-stdio.ts", import.meta.url));
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

/** How Codex names a mock muggle tool to the model and its hooks: `mcp__muggle__muggle_local_execute_replay`. */
export const MOCK_TOOL_PREFIX = `mcp__${MOCK_STDIO_SERVER_NAME}__`;

/** A string as a TOML basic string. JSON's escapes are TOML's, bar DEL, which TOML also wants escaped. */
export function tomlString(value: string): string {
  return JSON.stringify(value).replace(/\x7f/g, "\\u007f");
}

/**
 * The `[mcp_servers.muggle]` table serving the mock tools for one fixtures
 * file over stdio. Required, so its tools are offered from the first request
 * — as the agent SDK's in-process mount is — and approved, so `codex exec`
 * runs them without a prompt no one can answer.
 */
export function mockMcpServerToml(fixturesPath: string): string[] {
  return [
    `[mcp_servers.${MOCK_STDIO_SERVER_NAME}]`,
    `command = ${tomlString(process.execPath)}`,
    `args = [${[TSX_CLI, MOCK_STDIO_SERVER, fixturesPath].map(tomlString).join(", ")}]`,
    "required = true",
    "startup_timeout_sec = 60",
    `default_tools_approval_mode = "approve"`,
  ];
}

/** The bare mock tool name (`muggle-local-execute-test-generation`) for each name Codex gives the model. */
export function mockToolNamesByCodexName(fixtures: Fixtures): Map<string, string> {
  return new Map(
    mockToolSpecs(fixtures).map((spec) => [`${MOCK_TOOL_PREFIX}${spec.name.replace(/[^A-Za-z0-9_]/g, "_")}`, spec.name]),
  );
}

/**
 * Make `codexHome` a Codex home the eval owns and write its config.toml.
 *
 * @throws when `codexHome` holds a config.toml the eval did not write — it is
 * someone's Codex setup, and the eval would overwrite it.
 */
export function writeEvalCodexConfig(codexHome: string, lines: string[]): void {
  fs.mkdirSync(codexHome, { recursive: true });
  const configPath = path.join(codexHome, "config.toml");
  if (fs.existsSync(configPath) && !fs.readFileSync(configPath, "utf8").startsWith(CODEX_EVAL_HOME_MARKER)) {
    throw new Error(`refusing to overwrite ${configPath}: point --codex-home at a directory the eval owns`);
  }
  fs.writeFileSync(configPath, [CODEX_EVAL_HOME_MARKER, ...lines, ""].join("\n"));
}

/** Install `hookScript` as a PreToolUse hook on every tool — no matcher — in `codexHome`. */
export function writeEvalPreToolUseHook(codexHome: string, hookScript: string, description: string): void {
  const hooks = {
    description: description,
    hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `node "${hookScript}"`, timeout: 30 }] }] },
  };
  fs.writeFileSync(path.join(codexHome, "hooks.json"), `${JSON.stringify(hooks, null, 2)}\n`);
}

/** argv that runs Codex: the native binary, or the npm package's `bin/codex.js` under node. */
function codexCommand(args: string[]): { program: string; argv: string[] } {
  const codexBin = process.env.CODEX_BIN ?? "codex";
  return /\.m?js$/.test(codexBin)
    ? { program: process.execPath, argv: [codexBin, ...args] }
    : { program: codexBin, argv: args };
}

/** Run one `codex exec` turn to its end, or kill it at the turn ceiling. */
export function runCodexTurn(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<CodexTurnOutput> {
  const { program, argv } = codexCommand(args);
  return new Promise((resolve, reject) => {
    const child = spawn(program, argv, { cwd: cwd, env: env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    const timer = setTimeout(() => child.kill("SIGKILL"), CODEX_TURN_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status: status, stdout: stdout, stderr: stderr });
    });
  });
}

/** Every event a `codex exec --json` turn printed, in order. */
export function codexEvents(stream: string): Array<Record<string, unknown>> {
  return stream.split(/\r?\n/).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

/** The thread a `codex exec --json` turn ran in, from its `thread.started` event. */
export function threadIdOf(stream: string): string {
  const started = codexEvents(stream).find((event) => event.type === "thread.started");
  return typeof started?.thread_id === "string" ? started.thread_id : "";
}

/** The turn's closing message: the last `agent_message` it completed, or "". */
export function closingMessageOf(stream: string): string {
  let text = "";
  for (const event of codexEvents(stream)) {
    const item = event.item as { type?: unknown; text?: unknown } | undefined;
    if (event.type === "item.completed" && item?.type === "agent_message" && typeof item.text === "string") {
      text = item.text;
    }
  }
  return text;
}

/** Why a turn failed — the `turn.failed` message, or "" for a turn that completed. Codex also reports errors it retried past, which are not failures. */
export function turnFailureOf(stream: string): string {
  const failed = codexEvents(stream).find((event) => event.type === "turn.failed");
  if (!failed) return "";
  const message = (failed.error as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message ? message : "turn failed";
}

/**
 * Throw for a turn that failed, with Codex's own message — so a rate limit is
 * retried by the caller's throttle backoff, as an agent SDK rate limit is.
 */
export function throwIfTurnFailed(turn: CodexTurnOutput): void {
  const failure = turnFailureOf(turn.stdout);
  if (turn.status !== 0 || failure) {
    throw new Error(`codex exec exited ${turn.status}: ${failure || turn.stderr.trim().slice(-1500)}`);
  }
}
