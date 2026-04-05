/**
 * Serve command - starts the MCP server.
 */

import { getConfig, getLocalQaTools, getLogger, getQaTools } from "../../packages/mcps/src/index.js";
import { createUnifiedMcpServer, registerTools, startStdioServer } from "../server/index.js";

const logger = getLogger();

/**
 * Options for the serve command.
 */
export interface IServeOptions {
  /** Only enable cloud E2E acceptance tools. */
  e2e?: boolean;
  /** Only enable local E2E acceptance tools. */
  local?: boolean;
  /** Use stdio transport. */
  stdio?: boolean;
}

/**
 * Execute the serve command.
 * @param options - Command options.
 */
export async function serveCommand (options: IServeOptions): Promise<void> {
  const config = getConfig();

  // Determine which tool sets to enable
  const enableQa = options.local ? false : true;
  const enableLocal = options.e2e ? false : true;

  logger.info("Starting Muggle MCP Server", {
    version: config.serverVersion,
    enableQa: enableQa,
    enableLocal: enableLocal,
    transport: "stdio",
  });

  try {
    // Register tools based on options
    if (enableQa) {
      const qaTools = getQaTools();
      registerTools(qaTools);
      logger.info("Registered cloud E2E acceptance tools", { count: qaTools.length });
    }

    if (enableLocal) {
      const localTools = getLocalQaTools();
      registerTools(localTools);
      logger.info("Registered local E2E acceptance tools", { count: localTools.length });
    }

    // Create unified MCP server
    const mcpServer = createUnifiedMcpServer({
      enableQaTools: enableQa,
      enableLocalTools: enableLocal,
    });

    // Start stdio server (MCP clients communicate via stdin/stdout)
    await startStdioServer(mcpServer);

    logger.info("MCP server started successfully");
  } catch (error) {
    logger.error("Failed to start MCP server", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
}

