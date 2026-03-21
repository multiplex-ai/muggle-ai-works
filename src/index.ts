/**
 * @muggleai/works - Unified MCP Server for Muggle AI
 *
 * This package provides a single MCP server that combines:
 * - Cloud QA tools (from mcp-qa-gateway)
 * - Local testing tools (from local-mcp)
 *
 * Usage:
 *   # Start MCP server (default - all tools)
 *   muggle serve
 *   muggle
 *
 *   # Start with specific tool sets
 *   muggle serve --qa      # Cloud QA tools only
 *   muggle serve --local   # Local testing tools only
 *
 *   # Setup and diagnostics
 *   muggle setup           # Download Electron app
 *   muggle doctor          # Diagnose installation
 *
 *   # Authentication
 *   muggle login           # Authenticate with Muggle AI
 *   muggle logout          # Clear credentials
 *   muggle status          # Show auth status
 */

// Export modules as namespaces to avoid naming conflicts
export * as commands from "../packages/commands/src/index.js";
export * as shared from "../packages/mcps/src/index.js";
export * as server from "./server/index.js";
export {
  getLocalQaTools,
  getQaTools,
  localQa,
  mcp,
  qa,
} from "../packages/mcps/src/index.js";

// Also export key functions at top level for convenience
export { getConfig } from "../packages/mcps/src/index.js";
export { createChildLogger, getLogger } from "../packages/mcps/src/index.js";
export { createUnifiedMcpServer } from "./server/index.js";
