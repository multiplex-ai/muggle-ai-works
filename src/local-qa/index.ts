/**
 * Local QA tools module.
 * Local testing tools that work with the Electron app.
 *
 * NOTE: Full migration from local-mcp is pending.
 * The local-mcp package has 133 source files including:
 * - Project management tools (create, list, get, update, delete)
 * - Use case tools (save, list, get, update, delete)
 * - Test case tools (save, list, get, update, delete)
 * - Test script tools (save, list, get, delete)
 * - Execution tools (test generation, replay, cancel)
 * - Cloud sync tools (pull project, push project)
 * - Session management tools
 * - Storage services
 *
 * To complete the migration:
 * 1. Copy tools from muggle-ai-teaching-service/packages/local-mcp/src/tools/
 * 2. Copy services from muggle-ai-teaching-service/packages/local-mcp/src/services/
 * 3. Adapt imports to new package structure
 */

import type { IMcpTool } from "../shared/types.js";

/**
 * All Local QA tools.
 * These tools work locally without cloud authentication.
 */
export const localQaTools: IMcpTool[] = [
  // Tools will be migrated from local-mcp
  // For now, this is an empty array - local tools are not yet available in the unified package
];

/**
 * Get all Local QA tools.
 * @returns Array of Local QA tool definitions.
 */
export function getLocalQaTools(): IMcpTool[] {
  return localQaTools;
}
