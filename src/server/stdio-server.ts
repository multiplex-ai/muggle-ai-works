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

/** Exit when the MCP host closes our stdin (its end of the pipe). */
function watchForParentDeath (shutdown: (reason: string) => void): void {
  process.stdin.on("end", () => shutdown("stdin-end"));
  process.stdin.on("close", () => shutdown("stdin-close"));
}
