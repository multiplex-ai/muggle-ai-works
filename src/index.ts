/**
 * @muggleai/works - Ship quality products, not just code.
 *
 * AI-powered E2E acceptance testing that validates your web app like a real user.
 * Provides MCP tools and CLI for:
 * - Cloud E2E acceptance (validate user flows via Muggle AI; muggle-remote-* tools)
 * - Local E2E acceptance (validate your app before pushing; muggle-local-* tools)
 *
 * Usage:
 *   # Start MCP server (default - all tools)
 *   muggle serve
 *   muggle
 *
 *   # Start with specific tool sets
 *   muggle serve --e2e     # Cloud E2E acceptance tools only
 *   muggle serve --local   # Local E2E acceptance tools only
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
  e2e,
  qa,
} from "../packages/mcps/src/index.js";

// Also export key functions at top level for convenience
export { getConfig } from "../packages/mcps/src/index.js";
export { createChildLogger, getLogger } from "../packages/mcps/src/index.js";
export { createUnifiedMcpServer } from "./server/index.js";
