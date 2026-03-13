#!/usr/bin/env node
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

import { runCli } from "./cli/index.js";

// Run the CLI
runCli().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
