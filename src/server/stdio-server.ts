/**
 * Stdio server implementation for @muggleai/mcp.
 * Runs the MCP server using stdin/stdout transport.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { getLogger } from "../shared/logger.js";

const logger = getLogger();

/**
 * Start the MCP server using stdio transport.
 * @param server - Configured MCP Server instance.
 */
export async function startStdioServer(server: Server): Promise<void> {
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
}
