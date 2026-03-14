#!/usr/bin/env node
/**
 * CLI entry point for muggle-mcp.
 */

import { runCli } from "./index.js";

runCli().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
