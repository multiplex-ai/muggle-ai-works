/**
 * Local QA module for the unified MCP package.
 *
 * This module provides local testing capabilities including:
 * - Project management (create, list, update, delete)
 * - Use case management
 * - Test case management
 * - Test script management
 * - Test execution (generation and replay)
 * - Session management
 * - Local secret management
 */

import type { IMcpTool } from "../shared/types.js";

import { allLocalQaTools } from "./tools/index.js";

// Re-export types
export * from "./types/index.js";

// Re-export contracts
export * from "./contracts/index.js";

// Re-export services
export * from "./services/index.js";

// Re-export tools
export * from "./tools/index.js";

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
 * Tools that only interact with local storage don't need authentication.
 */
function isLocalOnlyTool(toolName: string): boolean {
  const localOnlyTools = [
    // Auth tools (handle their own auth)
    "muggle_auth_status",
    "muggle_auth_login",
    "muggle_auth_poll",
    "muggle_auth_logout",
    // Status and session tools
    "muggle_check_status",
    "muggle_list_sessions",
    "muggle_cleanup_sessions",
    "muggle_get_page_state",
    // Project management (local storage only)
    "muggle_project_create",
    "muggle_project_list",
    "muggle_project_get",
    "muggle_project_update",
    "muggle_project_delete",
    // Use case management (local storage only)
    "muggle_use_case_save",
    "muggle_use_case_list",
    "muggle_use_case_get",
    "muggle_use_case_update",
    "muggle_use_case_delete",
    // Test case management (local storage only)
    "muggle_test_case_save",
    "muggle_test_case_list",
    "muggle_test_case_get",
    "muggle_test_case_update",
    "muggle_test_case_delete",
    // Test script management (local storage only)
    "muggle_test_script_save",
    "muggle_test_script_list",
    "muggle_test_script_get",
    "muggle_test_script_delete",
    // Run result management (local storage only)
    "muggle_run_result_list",
    "muggle_run_result_get",
    // Local secret management
    "muggle_secret_create",
    "muggle_secret_list",
    "muggle_secret_get",
    "muggle_secret_update",
    "muggle_secret_delete",
    // Workflow file management (local)
    "muggle_workflow_file_create",
    "muggle_workflow_file_list",
    "muggle_workflow_file_list_available",
    "muggle_workflow_file_get",
    "muggle_workflow_file_update",
    "muggle_workflow_file_delete",
  ];

  return localOnlyTools.includes(toolName);
}
