/**
 * @muggleai/mcp - Unified MCP Server for Muggle AI
 *
 * This package provides a single MCP server that combines:
 * - Cloud QA tools (from mcp-qa-gateway)
 * - Local testing tools (from local-mcp)
 *
 * Usage:
 *   # Start MCP server (default - all tools)
 *   muggle-mcp serve
 *   muggle-mcp
 *
 *   # Start with specific tool sets
 *   muggle-mcp serve --qa      # Cloud QA tools only
 *   muggle-mcp serve --local   # Local testing tools only
 *
 *   # Setup and diagnostics
 *   muggle-mcp setup           # Download Electron app
 *   muggle-mcp doctor          # Diagnose installation
 *
 *   # Authentication
 *   muggle-mcp login           # Authenticate with Muggle AI
 *   muggle-mcp logout          # Clear credentials
 *   muggle-mcp status          # Show auth status
 */

// Export modules as namespaces to avoid naming conflicts
export * as shared from "./shared/index.js";
export * as server from "./server/index.js";
export * as qa from "./qa/index.js";
export * as localQa from "./local-qa/index.js";

// Also export key functions at top level for convenience
export { getConfig } from "./shared/index.js";
export { getLogger, createChildLogger } from "./shared/index.js";
export { createUnifiedMcpServer } from "./server/index.js";
export { getQaTools } from "./qa/index.js";
export { getLocalQaTools } from "./local-qa/index.js";
