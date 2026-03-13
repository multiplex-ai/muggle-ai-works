/**
 * QA Gateway tools module.
 * Cloud-based QA tools that require authentication.
 *
 * TODO: Migrate tools from mcp-qa-gateway package.
 */

import type { IMcpTool } from "../shared/types.js";

/**
 * All QA Gateway tools.
 * These tools communicate with the Muggle AI cloud backend.
 */
export const qaTools: IMcpTool[] = [
  // Tools will be migrated from mcp-qa-gateway
  // See: muggle-ai-prompt-service/mcp-gateway/src/tools/
];

/**
 * Get all QA tools.
 * @returns Array of QA tool definitions.
 */
export function getQaTools(): IMcpTool[] {
  return qaTools;
}
