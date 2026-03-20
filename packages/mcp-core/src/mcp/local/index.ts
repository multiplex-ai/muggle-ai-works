/**
 * Local QA module for the unified MCP package.
 *
 * This module provides minimal local testing capabilities:
 * - Status and session management
 * - Test execution (generation and replay) using cloud test cases
 * - Run result viewing
 * - Test script viewing
 * - Publishing to cloud
 *
 * All entity management (projects, use cases, test cases, secrets) happens
 * via qa_* cloud tools. Local tools only handle execution and results.
 */

import type { IMcpTool } from "../../shared/types.js";

import { allLocalQaTools } from "../tools/local/index.js";

// Re-export types
export * from "./types/index.js";

// Re-export contracts
export * from "./contracts/index.js";

// Re-export services
export * from "./services/index.js";

// Re-export tools
export * from "../tools/local/index.js";

/**
 * Get all local QA tools as IMcpTool instances for registration.
 *
 * Maps the ILocalMcpTool interface to the generic IMcpTool interface
 * used by the unified MCP server.
 *
 * @returns Array of MCP tool definitions.
 */
export function getLocalQaTools(): IMcpTool[] {
  return allLocalQaTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    requiresAuth: !isLocalOnlyTool(tool.name),
    execute: async (params: { input: unknown; correlationId: string }) => {
      const result = await tool.execute({
        input: params.input,
        correlationId: params.correlationId,
      });
      return {
        content: result.content,
        isError: result.isError,
        data: result.data,
      };
    },
  }));
}

/**
 * Check if a tool is local-only (doesn't require cloud auth).
 *
 * Status and session tools don't need authentication.
 * Execution and publishing tools require auth (handled internally).
 */
function isLocalOnlyTool(toolName: string): boolean {
  const localOnlyTools = [
    // Status and session tools (no auth needed)
    "muggle_check_status",
    "muggle_list_sessions",
    // Run result and test script viewing (local storage only)
    "muggle_run_result_list",
    "muggle_run_result_get",
    "muggle_test_script_list",
    "muggle_test_script_get",
  ];

  return localOnlyTools.includes(toolName);
}
