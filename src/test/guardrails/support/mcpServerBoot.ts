import { spawn } from "child_process";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  MCP_SERVER_BOOT_ENTRY,
  MCP_SERVER_BOOT_TIMEOUT_MS,
  REPO_ROOT,
  SPAWN_RECORDER_PRELOAD,
  UNREACHABLE_TELEMETRY_CONNECTION_STRING,
} from "./constants.js";
import type { RecordedUnhiddenSpawn } from "./types.js";

/**
 * Boots the real MCP server in a fresh home with telemetry switched on, under the spawn recorder, and lets it settle.
 * @param environmentOverrides - Variables set on top of the boot environment.
 * @returns Every child process the server started without `windowsHide`.
 */
export async function bootMcpServerRecordingUnhiddenSpawns(
  environmentOverrides: Record<string, string> = {},
): Promise<RecordedUnhiddenSpawn[]> {
  const isolatedHome = mkdtempSync(join(tmpdir(), "muggle-mcp-boot-"));
  const recordFile = join(isolatedHome, "unhidden-spawns.jsonl");
  const bootEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: isolatedHome,
    USERPROFILE: isolatedHome,
    APPLICATIONINSIGHTS_CONNECTION_STRING: UNREACHABLE_TELEMETRY_CONNECTION_STRING,
    MUGGLE_SPAWN_RECORD_FILE: recordFile,
    ...environmentOverrides,
  };
  if (!("OTEL_NODE_RESOURCE_DETECTORS" in environmentOverrides)) delete bootEnvironment.OTEL_NODE_RESOURCE_DETECTORS;

  const server = spawn(
    process.execPath,
    ["--import", SPAWN_RECORDER_PRELOAD, "--import", "tsx", MCP_SERVER_BOOT_ENTRY],
    { cwd: REPO_ROOT, env: bootEnvironment, stdio: ["pipe", "ignore", "pipe"], windowsHide: true },
  );
  let serverErrorOutput = "";
  server.stderr.on("data", (chunk: Buffer) => {
    serverErrorOutput += chunk.toString();
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const deadline = setTimeout(() => {
      server.kill();
      reject(new Error(`MCP server boot did not finish within ${MCP_SERVER_BOOT_TIMEOUT_MS}ms\n${serverErrorOutput}`));
    }, MCP_SERVER_BOOT_TIMEOUT_MS);
    server.on("exit", (code) => {
      clearTimeout(deadline);
      resolve(code);
    });
  });
  if (exitCode !== 0) throw new Error(`MCP server boot exited ${exitCode}\n${serverErrorOutput}`);

  if (!existsSync(recordFile)) return [];
  return readFileSync(recordFile, "utf-8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as RecordedUnhiddenSpawn);
}
