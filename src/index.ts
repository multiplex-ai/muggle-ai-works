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
export * as shared from "./shared/index.js";
export * as server from "./server/index.js";
export {
  getLocalQaTools,
  getQaTools,
  localQa,
  mcp,
  qa,
} from "@muggleai/mcp-core";

// Also export key functions at top level for convenience
export { getConfig } from "./shared/index.js";
export { getLogger, createChildLogger } from "./shared/index.js";
export { createUnifiedMcpServer } from "./server/index.js";
