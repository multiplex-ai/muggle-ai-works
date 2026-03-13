/**
 * QA Gateway tools module.
 * Cloud-based QA tools that require authentication.
 */

import type { IMcpTool } from "../shared/types.js";

import { allQaToolDefinitions, executeQaTool } from "./tools/tool-registry.js";

export * from "./contracts/index.js";
export * from "./tools/index.js";
export * from "./types.js";
export * from "./upstream-client.js";

/**
 * Convert QA tool definitions to IMcpTool format.
 * @returns Array of IMcpTool definitions.
 */
export function getQaTools(): IMcpTool[] {
  return allQaToolDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    requiresAuth: tool.requiresAuth !== false,
    execute: async (params: { input: unknown; correlationId: string }) => {
      return executeQaTool(tool.name, params.input, params.correlationId);
    },
  }));
}
