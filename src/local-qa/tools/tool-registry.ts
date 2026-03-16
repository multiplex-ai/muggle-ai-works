/**
 * Tool registry for local-qa.
 * Manages the minimal set of local execution tools.
 *
 * All entity management (projects, use cases, test cases, secrets) happens via qa_* cloud tools.
 * Local tools only handle: status, execution, results, and publishing.
 */

import { getLogger } from "../../shared/logger.js";
import type { IMcpToolResult, ILocalMcpTool } from "../types/index.js";
import {
  EmptyInputSchema,
  ListSessionsInputSchema,
  ExecuteTestGenerationInputSchema,
  ExecuteReplayInputSchema,
  CancelExecutionInputSchema,
  RunResultListInputSchema,
  RunResultGetInputSchema,
  TestScriptListInputSchema,
  TestScriptGetInputSchema,
  PublishTestScriptInputSchema,
} from "../contracts/index.js";
import {
  cancelExecution,
  executeReplay,
  executeTestGeneration,
  getAuthService,
  getStorageService,
  getRunResultStorageService,
} from "../services/index.js";

/**
 * Create a child logger for correlation.
 */
function createChildLogger(correlationId: string) {
  const logger = getLogger();
  return {
    info: (msg: string, meta?: Record<string, unknown>) => logger.info(msg, { ...meta, correlationId: correlationId }),
    error: (msg: string, meta?: Record<string, unknown>) => logger.error(msg, { ...meta, correlationId: correlationId }),
    warn: (msg: string, meta?: Record<string, unknown>) => logger.warn(msg, { ...meta, correlationId: correlationId }),
    debug: (msg: string, meta?: Record<string, unknown>) => logger.debug(msg, { ...meta, correlationId: correlationId }),
  };
}

// ========================================
// Status Tools
// ========================================

const checkStatusTool: ILocalMcpTool = {
  name: "muggle_check_status",
  description: "Check the status of Muggle Test Local. This verifies the connection to web-service and shows current session information.",
  inputSchema: EmptyInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_check_status");

    const authService = getAuthService();
    const storageService = getStorageService();
    const authStatus = authService.getAuthStatus();

    const content = [
      "## Muggle Test Local Status",
      "",
      `**Data Directory:** ${storageService.getDataDir()}`,
      `**Sessions Directory:** ${storageService.getSessionsDir()}`,
      "",
      "### Authentication",
      `**Authenticated:** ${authStatus.authenticated ? "Yes" : "No"}`,
      authStatus.email ? `**Email:** ${authStatus.email}` : "",
      authStatus.expiresAt ? `**Expires:** ${authStatus.expiresAt}` : "",
    ].filter(Boolean).join("\n");

    return { content: content, isError: false };
  },
};

const listSessionsTool: ILocalMcpTool = {
  name: "muggle_list_sessions",
  description: "List all stored testing sessions. Shows session IDs, status, and metadata for each session.",
  inputSchema: ListSessionsInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_list_sessions");

    const input = ListSessionsInputSchema.parse(ctx.input);
    const storageService = getStorageService();
    const sessions = storageService.listSessionsWithMetadata();
    const limit = input.limit ?? 10;
    const limited = sessions.slice(0, limit);

    if (limited.length === 0) {
      return { content: "No sessions found.", isError: false, data: { sessions: [] } };
    }

    const lines = limited.map((s) => {
      return `- **${s.sessionId}** - ${s.status} - ${s.targetUrl} (${s.stepsCount ?? 0} steps)`;
    });

    const content = [
      "## Sessions",
      "",
      ...lines,
      "",
      sessions.length > limit ? `Showing ${limit} of ${sessions.length} sessions.` : "",
    ].filter(Boolean).join("\n");

    return { content: content, isError: false, data: { sessions: limited } };
  },
};

// ========================================
// Run Result Tools
// ========================================

const runResultListTool: ILocalMcpTool = {
  name: "muggle_run_result_list",
  description: "List run results (test generation and replay history), optionally filtered by cloud test case ID.",
  inputSchema: RunResultListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_run_result_list");

    const input = RunResultListInputSchema.parse(ctx.input);
    const storage = getRunResultStorageService();
    let results = storage.listRunResults();

    if (input.cloudTestCaseId) {
      results = results.filter((r) => r.cloudTestCaseId === input.cloudTestCaseId);
    }

    const limit = input.limit ?? 20;
    results = results.slice(0, limit);

    if (results.length === 0) {
      return { content: "No run results found.", isError: false, data: { results: [] } };
    }

    const lines = results.map((r) => {
      return `- **${r.id}** - ${r.runType} - ${r.status} (${r.executionTimeMs ?? 0}ms)`;
    });

    const content = ["## Run Results", "", ...lines].join("\n");

    return { content: content, isError: false, data: { results: results } };
  },
};

const runResultGetTool: ILocalMcpTool = {
  name: "muggle_run_result_get",
  description: "Get detailed information about a run result including screenshots and action script output.",
  inputSchema: RunResultGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_run_result_get");

    const input = RunResultGetInputSchema.parse(ctx.input);
    const storage = getRunResultStorageService();
    const result = storage.getRunResult(input.runId);

    if (!result) {
      return { content: `Run result not found: ${input.runId}`, isError: true };
    }

    const content = [
      "## Run Result Details",
      "",
      `**ID:** ${result.id}`,
      `**Type:** ${result.runType}`,
      `**Status:** ${result.status}`,
      `**Cloud Test Case:** ${result.cloudTestCaseId}`,
      `**Duration:** ${result.executionTimeMs ?? 0}ms`,
      result.errorMessage ? `**Error:** ${result.errorMessage}` : "",
    ].filter(Boolean).join("\n");

    return { content: content, isError: false, data: result };
  },
};

// ========================================
// Test Script Tools (Read-only - scripts are generated during execution)
// ========================================

const testScriptListTool: ILocalMcpTool = {
  name: "muggle_test_script_list",
  description: "List locally generated test scripts, optionally filtered by cloud test case ID.",
  inputSchema: TestScriptListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_script_list");

    const input = TestScriptListInputSchema.parse(ctx.input);
    const storage = getRunResultStorageService();
    let scripts = storage.listTestScripts();

    if (input.cloudTestCaseId) {
      scripts = scripts.filter((s) => s.cloudTestCaseId === input.cloudTestCaseId);
    }

    if (scripts.length === 0) {
      return { content: "No test scripts found.", isError: false, data: { testScripts: [] } };
    }

    const lines = scripts.map((ts) => `- **${ts.name}** (${ts.id}) - ${ts.status}`);
    const content = ["## Test Scripts", "", ...lines].join("\n");

    return { content: content, isError: false, data: { testScripts: scripts } };
  },
};

const testScriptGetTool: ILocalMcpTool = {
  name: "muggle_test_script_get",
  description: "Get details of a locally generated test script including action script steps.",
  inputSchema: TestScriptGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_script_get");

    const input = TestScriptGetInputSchema.parse(ctx.input);
    const storage = getRunResultStorageService();
    const testScript = storage.getTestScript(input.testScriptId);

    if (!testScript) {
      return { content: `Test script not found: ${input.testScriptId}`, isError: true };
    }

    const content = [
      "## Test Script Details",
      "",
      `**ID:** ${testScript.id}`,
      `**Name:** ${testScript.name}`,
      `**URL:** ${testScript.url}`,
      `**Status:** ${testScript.status}`,
      testScript.goal ? `**Goal:** ${testScript.goal}` : "",
      testScript.actionScript ? `**Steps:** ${testScript.actionScript.length}` : "",
    ].filter(Boolean).join("\n");

    return { content: content, isError: false, data: testScript };
  },
};

// ========================================
// Execution Tools
// ========================================

const executeTestGenerationTool: ILocalMcpTool = {
  name: "muggle_execute_test_generation",
  description: "Execute test script generation for a test case. First call qa_test_case_get to get test case details, then pass them here along with the localhost URL. Requires explicit approval before launching electron-app in explore mode.",
  inputSchema: ExecuteTestGenerationInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_execute_test_generation");

    const input = ExecuteTestGenerationInputSchema.parse(ctx.input);

    if (!input.approveElectronAppLaunch) {
      return {
        content: [
          "## Electron App Launch Required",
          "",
          "This tool will launch the electron-app to generate a test script.",
          "Please set `approveElectronAppLaunch: true` to proceed.",
          "",
          `**Test Case:** ${input.testCase.title}`,
          `**Local URL:** ${input.localUrl}`,
          "",
          "**Note:** The electron-app will open a browser window and navigate to your test URL.",
        ].join("\n"),
        isError: false,
        data: { requiresApproval: true },
      };
    }

    try {
      const result = await executeTestGeneration({
        testCase: input.testCase,
        localUrl: input.localUrl,
        timeoutMs: input.timeoutMs,
      });

      const content = [
        "## Test Generation " + (result.status === "passed" ? "Successful" : "Failed"),
        "",
        `**Run ID:** ${result.id}`,
        `**Test Script ID:** ${result.testScriptId}`,
        `**Status:** ${result.status}`,
        `**Duration:** ${result.executionTimeMs}ms`,
        result.errorMessage ? `**Error:** ${result.errorMessage}` : "",
      ].filter(Boolean).join("\n");

      return {
        content: content,
        isError: result.status !== "passed",
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Test generation failed", { error: errorMessage });
      return { content: `Test generation failed: ${errorMessage}`, isError: true };
    }
  },
};

const executeReplayTool: ILocalMcpTool = {
  name: "muggle_execute_replay",
  description: "Execute test script replay. First call qa_test_script_get to get test script details (including actionScript), then pass them here along with the localhost URL. Requires explicit approval before launching electron-app in engine mode.",
  inputSchema: ExecuteReplayInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_execute_replay");

    const input = ExecuteReplayInputSchema.parse(ctx.input);

    if (!input.approveElectronAppLaunch) {
      return {
        content: [
          "## Electron App Launch Required",
          "",
          "This tool will launch the electron-app to replay a test script.",
          "Please set `approveElectronAppLaunch: true` to proceed.",
          "",
          `**Test Script:** ${input.testScript.name}`,
          `**Local URL:** ${input.localUrl}`,
          `**Steps:** ${input.testScript.actionScript.length}`,
          "",
          "**Note:** The electron-app will open a browser window and execute the test steps.",
        ].join("\n"),
        isError: false,
        data: { requiresApproval: true },
      };
    }

    try {
      const result = await executeReplay({
        testScript: input.testScript,
        localUrl: input.localUrl,
        timeoutMs: input.timeoutMs,
      });

      const content = [
        "## Test Replay " + (result.status === "passed" ? "Successful" : "Failed"),
        "",
        `**Run ID:** ${result.id}`,
        `**Test Script ID:** ${result.testScriptId}`,
        `**Status:** ${result.status}`,
        `**Duration:** ${result.executionTimeMs}ms`,
        result.errorMessage ? `**Error:** ${result.errorMessage}` : "",
      ].filter(Boolean).join("\n");

      return {
        content: content,
        isError: result.status !== "passed",
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Test replay failed", { error: errorMessage });
      return { content: `Test replay failed: ${errorMessage}`, isError: true };
    }
  },
};

const cancelExecutionTool: ILocalMcpTool = {
  name: "muggle_cancel_execution",
  description: "Cancel an active test generation or replay execution.",
  inputSchema: CancelExecutionInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cancel_execution");

    const input = CancelExecutionInputSchema.parse(ctx.input);

    const cancelled = cancelExecution({ runId: input.runId });

    if (cancelled) {
      return { content: `Execution cancelled: ${input.runId}`, isError: false };
    }

    return { content: `No active execution found with ID: ${input.runId}`, isError: true };
  },
};

// ========================================
// Publishing Tools
// ========================================

const publishTestScriptTool: ILocalMcpTool = {
  name: "muggle_publish_test_script",
  description: "Publish a locally generated test script to the cloud. Uses the run ID from muggle_execute_test_generation to find the script and uploads it to the specified cloud test case.",
  inputSchema: PublishTestScriptInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_publish_test_script");

    const input = PublishTestScriptInputSchema.parse(ctx.input);
    const storage = getRunResultStorageService();

    // Get the run result to find the test script
    const runResult = storage.getRunResult(input.runId);
    if (!runResult) {
      return { content: `Run result not found: ${input.runId}`, isError: true };
    }

    if (!runResult.testScriptId) {
      return { content: `Run result ${input.runId} does not have an associated test script`, isError: true };
    }

    const testScript = storage.getTestScript(runResult.testScriptId);
    if (!testScript) {
      return { content: `Test script not found: ${runResult.testScriptId}`, isError: true };
    }

    // TODO: Implement actual publish to cloud via prompt-service client
    // For now, return placeholder
    return {
      content: [
        "## Test Script Publishing",
        "",
        "Publishing test scripts to cloud is not yet implemented.",
        "",
        `**Run ID:** ${input.runId}`,
        `**Test Script ID:** ${runResult.testScriptId}`,
        `**Target Cloud Test Case:** ${input.cloudTestCaseId}`,
      ].join("\n"),
      isError: true,
    };
  },
};

// ========================================
// All Tools Registry
// ========================================

/**
 * All registered local QA tools.
 * Minimal set focused on execution and results.
 */
export const allLocalQaTools: ILocalMcpTool[] = [
  // Status tools
  checkStatusTool,
  listSessionsTool,
  // Run result tools
  runResultListTool,
  runResultGetTool,
  // Test script tools (read-only)
  testScriptListTool,
  testScriptGetTool,
  // Execution tools
  executeTestGenerationTool,
  executeReplayTool,
  cancelExecutionTool,
  // Publishing tools
  publishTestScriptTool,
];

/**
 * Map of tool name to tool definition for fast lookup.
 */
const toolMap: Map<string, ILocalMcpTool> = new Map(
  allLocalQaTools.map((tool) => [tool.name, tool]),
);

/**
 * Get a tool by name.
 */
export function getTool(name: string): ILocalMcpTool | undefined {
  return toolMap.get(name);
}

/**
 * Execute a tool by name.
 */
export async function executeTool(
  name: string,
  input: unknown,
  correlationId: string,
): Promise<IMcpToolResult> {
  const tool = getTool(name);

  if (!tool) {
    return {
      content: `Unknown tool: ${name}. Available tools: ${allLocalQaTools.map((t) => t.name).join(", ")}`,
      isError: true,
    };
  }

  return tool.execute({ input: input, correlationId: correlationId });
}
