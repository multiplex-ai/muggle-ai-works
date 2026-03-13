/**
 * Local QA tools module.
 * Local testing tools that work with the Electron app.
 *
 * TODO: Migrate tools from local-mcp package.
 */

import type { IMcpTool } from "../shared/types.js";

/**
 * All Local QA tools.
 * These tools work locally without cloud authentication.
 */
export const localQaTools: IMcpTool[] = [
  // Tools will be migrated from local-mcp
  // See: muggle-ai-teaching-service/packages/local-mcp/src/tools/
];

/**
 * Get all Local QA tools.
 * @returns Array of Local QA tool definitions.
 */
export function getLocalQaTools(): IMcpTool[] {
  return localQaTools;
}
