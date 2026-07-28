/**
 * Stdio server implementation for @muggleai/works.
 * Runs the MCP server using stdin/stdout transport.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getLogger } from "../../packages/mcps/src/index.js";

const logger = getLogger();

/**
 * Start the MCP server using stdio transport.
 * @param server - Configured MCP Server instance.
 */
export async function startStdioServer (server: Server): Promise<void> {
  logger.info("Starting stdio server transport");

  const transport = new StdioServerTransport();

  await server.connect(transport);

  logger.info("Stdio server connected");

  // Handle process signals for graceful shutdown
  const shutdown = (signal: string): void => {
    logger.info(`Received ${signal}, shutting down...`);
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Parent-death detection. Windows does NOT signal child processes when the
  // parent dies, so SIGTERM/SIGINT alone leak this process when Claude exits
  // abruptly (crash, sleep, killed bg job). Need to exit on parent-gone too.
  watchForParentDeath(shutdown);
}

const PARENT_POLL_INTERVAL_MS = 30_000;

/**
 * Exit when the MCP host goes away. Two independent signals, because neither
 * alone is sufficient on Windows:
 *
 * - stdin end/close fires when the host closes its end of the pipe on a *clean*
 *   exit.
 * - a PID poll catches *abrupt* host death (kill, crash, sleep) — Windows leaves
 *   our stdin pipe half-open in that case, so end/close never fire and the
 *   process would otherwise leak forever (the observed zombie-MCP pileup).
 */
function watchForParentDeath (shutdown: (reason: string) => void): void {
  process.stdin.on("end", () => shutdown("stdin-end"));
  process.stdin.on("close", () => shutdown("stdin-close"));

  const parentPid = process.ppid;
  // ppid 0/1 means no real parent to track (already reparented / detached);
  // polling it would risk exiting spuriously.
  if (!parentPid || parentPid <= 1) return;

  const timer = setInterval(() => {
    if (!parentIsAlive(parentPid)) shutdown("parent-gone");
  }, PARENT_POLL_INTERVAL_MS);
  // The poll must never be the reason the process stays alive.
  timer.unref();
}

/** Signal 0 probes existence without delivering a signal; EPERM = alive-but-foreign. */
function parentIsAlive (pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}
