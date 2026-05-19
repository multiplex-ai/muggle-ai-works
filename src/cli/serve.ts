/**
 * Serve command - starts the MCP server.
 */

import { getConfig, getLocalQaTools, getLogger, getQaTools } from "../../packages/mcps/src/index.js";
import {
  EventName,
  getDisclosureCopy,
  hasShownDisclosure,
  initTelemetry,
  markDisclosureShown,
  ServiceName,
  Surface,
  track,
} from "@muggleai/telemetry";
import { createUnifiedMcpServer, registerTools, startStdioServer } from "../server/index.js";

// Connection string is inlined at publish time via tsup `define` from the
// APPLICATIONINSIGHTS_CONNECTION_STRING env var (set from a GitHub secret in
// the publish workflow). Empty string in dev builds — telemetry is no-op.
const APPLICATIONINSIGHTS_CONNECTION_STRING: string =
  process.env.APPLICATIONINSIGHTS_CONNECTION_STRING ?? "";

// Show the one-time first-run disclosure on stderr before any event fires.
// Honors the 2026-05-05 client telemetry design: stderr is the only safe
// channel for an MCP stdio server (stdout is reserved for protocol output,
// and a blocking modal would break MCP host integrations).
function showDisclosureIfNeeded(): void {
  try {
    if (hasShownDisclosure()) return;
    process.stderr.write(getDisclosureCopy() + "\n");
    markDisclosureShown();
  } catch {
    // Disclosure write must never break the host process.
  }
}

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

  // Init client telemetry before any tool dispatch — no-op if not configured.
  try {
    showDisclosureIfNeeded();
    initTelemetry({
      serviceName: ServiceName.MuggleMcp,
      surface: Surface.McpLocal,
      connectionString: APPLICATIONINSIGHTS_CONNECTION_STRING,
    });
    track({ name: EventName.SystemStartup, props: { serviceName: ServiceName.MuggleMcp } });
  } catch (err) {
    logger.warn("Telemetry init skipped", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

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

