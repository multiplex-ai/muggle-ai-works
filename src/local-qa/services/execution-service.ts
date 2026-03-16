/**
 * Execution service for managing electron-app processes.
 * Handles test script generation and replay via direct electron-app execution.
 *
 * Design principle: This service accepts full test case/script details
 * (already fetched via qa_* tools by the agent). No cloud calls here.
 * - Stores run results locally
 * - Replaces production URLs with localhost URLs
 */

import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

import { getConfig } from "../../shared/config.js";
import type { TestCaseDetails, TestScriptDetails } from "../contracts/project-schemas.js";
import { getAuthService, getRunResultStorageService } from "./index.js";
import type { RunResultStatus } from "./run-result-storage-service.js";

// ========================================
// Types
// ========================================

/**
 * Internal execution process tracking.
 */
interface IInternalExecutionProcess {
  /** Run ID. */
  runId: string;
  /** Child process. */
  process: ReturnType<typeof spawn>;
  /** Run status. */
  status: RunResultStatus;
  /** Started timestamp. */
  startedAt: number;
  /** Timeout timer. */
  timeoutTimer?: ReturnType<typeof setTimeout>;
  /** Captured stdout. */
  capturedStdout: string;
  /** Captured stderr. */
  capturedStderr: string;
}

/**
 * Run result returned from execution.
 */
export interface ILocalRunResult {
  /** Run ID. */
  id: string;
  /** Test script ID. */
  testScriptId?: string;
  /** Run status. */
  status: "passed" | "failed";
  /** Execution time in ms. */
  executionTimeMs: number;
  /** Error message if failed. */
  errorMessage?: string;
}

// ========================================
// Active Process Tracking
// ========================================

/** Map of active execution processes. */
const activeProcesses: Map<string, IInternalExecutionProcess> = new Map();

// ========================================
// Auth Helpers
// ========================================

/**
 * Get the authenticated user ID.
 */
function getAuthenticatedUserId(): string {
  const authService = getAuthService();
  const authStatus = authService.getAuthStatus();

  if (!authStatus.authenticated) {
    throw new Error("Not authenticated. Please run qa_auth_login first.");
  }

  if (!authStatus.userId) {
    throw new Error("User ID not found in auth. Please re-authenticate.");
  }

  return authStatus.userId;
}

/**
 * Build auth content for electron-app.
 */
function buildStudioAuthContent(): { accessToken: string; email: string; userId: string } {
  const authService = getAuthService();
  const authStatus = authService.getAuthStatus();
  const storedAuth = authService.loadStoredAuth();

  if (!authStatus.authenticated || !storedAuth) {
    throw new Error("Not authenticated. Please run qa_auth_login first.");
  }

  if (!storedAuth.email || !storedAuth.userId) {
    throw new Error("Auth data incomplete. Please re-authenticate.");
  }

  return {
    accessToken: storedAuth.accessToken,
    email: storedAuth.email,
    userId: storedAuth.userId,
  };
}

// ========================================
// Temp File Helpers
// ========================================

/**
 * Ensure temp directory exists.
 */
async function ensureTempDir(): Promise<string> {
  const config = getConfig();
  const tempDir = path.join(config.localQa.dataDir, "temp");
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Write data to a temp file.
 */
async function writeTempFile(params: { filename: string; data: unknown }): Promise<string> {
  const tempDir = await ensureTempDir();
  const filePath = path.join(tempDir, params.filename);
  await fs.writeFile(filePath, JSON.stringify(params.data, null, 2));
  return filePath;
}

/**
 * Cleanup temp files.
 */
async function cleanupTempFiles(params: { filePaths: string[] }): Promise<void> {
  for (const filePath of params.filePaths) {
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ========================================
// Main Execution Functions
// ========================================

/**
 * Execute test script generation for a test case.
 *
 * Test case details should be fetched via qa_test_case_get before calling this.
 *
 * @param params - Execution parameters.
 * @param params.testCase - Test case details from qa_test_case_get.
 * @param params.localUrl - Local URL to test against.
 * @param params.timeoutMs - Optional timeout in milliseconds.
 * @returns Run result with generated script info.
 */
export async function executeTestGeneration(params: {
  testCase: TestCaseDetails;
  localUrl: string;
  timeoutMs?: number;
}): Promise<ILocalRunResult> {
  const { testCase, localUrl } = params;

  // Verify authentication (authContent will be used when electron-app integration is complete)
  getAuthenticatedUserId(); // Throws if not authenticated
  const authContent = buildStudioAuthContent();

  // Initialize run result storage
  const storage = getRunResultStorageService();
  const runResult = storage.createRunResult({
    runType: "generation",
    cloudTestCaseId: testCase.id,
    localUrl: localUrl,
  });

  try {
    // Create local test script record
    const localTestScript = storage.createTestScript({
      name: `Script for ${testCase.title}`,
      url: localUrl,
      cloudTestCaseId: testCase.id,
      goal: testCase.goal,
    });

    // Build action script for electron-app
    // TODO: Build proper action script using testCase details
    const actionScript = {
      steps: [
        {
          type: "navigate",
          url: localUrl,
        },
        {
          type: "explore",
          goal: testCase.goal,
          instructions: testCase.instructions,
          expectedResult: testCase.expectedResult,
        },
      ],
    };

    const runId = runResult.id;
    const startedAt = Date.now();

    // Write temp files
    const inputFilePath = await writeTempFile({
      filename: `${runId}_input.json`,
      data: actionScript,
    });
    const authFilePath = await writeTempFile({
      filename: `${runId}_auth.json`,
      data: authContent,
    });

    // TODO: Spawn electron-app and wait for completion
    // For now, simulate a failure since electron-app integration is not complete

    const completedAt = Date.now();
    const executionTimeMs = completedAt - startedAt;

    // Update run result with failure
    storage.updateRunResult(runId, {
      status: "failed",
      testScriptId: localTestScript.id,
      executionTimeMs: executionTimeMs,
      errorMessage: "Electron-app execution not yet implemented.",
    });

    // Cleanup temp files
    await cleanupTempFiles({ filePaths: [inputFilePath, authFilePath] });

    return {
      id: runId,
      testScriptId: localTestScript.id,
      status: "failed",
      executionTimeMs: executionTimeMs,
      errorMessage: "Electron-app execution not yet implemented.",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    storage.updateRunResult(runResult.id, {
      status: "failed",
      errorMessage: errorMessage,
    });

    return {
      id: runResult.id,
      status: "failed",
      executionTimeMs: 0,
      errorMessage: errorMessage,
    };
  }
}

/**
 * Execute test script replay.
 *
 * Test script details should be fetched via qa_test_script_get before calling this.
 *
 * @param params - Execution parameters.
 * @param params.testScript - Test script details from qa_test_script_get.
 * @param params.localUrl - Local URL to test against.
 * @param params.timeoutMs - Optional timeout in milliseconds.
 * @returns Run result.
 */
export async function executeReplay(params: {
  testScript: TestScriptDetails;
  localUrl: string;
  timeoutMs?: number;
}): Promise<ILocalRunResult> {
  const { testScript, localUrl } = params;

  // Verify authentication (authContent will be used when electron-app integration is complete)
  getAuthenticatedUserId(); // Throws if not authenticated
  const authContent = buildStudioAuthContent();

  // Initialize run result storage
  const storage = getRunResultStorageService();
  const runResult = storage.createRunResult({
    runType: "replay",
    cloudTestCaseId: testScript.testCaseId,
    localUrl: localUrl,
  });

  try {
    const runId = runResult.id;
    const startedAt = Date.now();

    // Rewrite URLs in action script to use local URL
    const rewrittenActionScript = rewriteActionScriptUrls({
      actionScript: testScript.actionScript,
      originalUrl: testScript.url,
      localUrl: localUrl,
    });

    // Write temp files
    const inputFilePath = await writeTempFile({
      filename: `${runId}_input.json`,
      data: rewrittenActionScript,
    });
    const authFilePath = await writeTempFile({
      filename: `${runId}_auth.json`,
      data: authContent,
    });

    // TODO: Spawn electron-app and wait for completion

    const completedAt = Date.now();
    const executionTimeMs = completedAt - startedAt;

    // Update run result with failure
    storage.updateRunResult(runId, {
      status: "failed",
      executionTimeMs: executionTimeMs,
      errorMessage: "Electron-app execution not yet implemented.",
    });

    // Cleanup temp files
    await cleanupTempFiles({ filePaths: [inputFilePath, authFilePath] });

    return {
      id: runId,
      status: "failed",
      executionTimeMs: executionTimeMs,
      errorMessage: "Electron-app execution not yet implemented.",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    storage.updateRunResult(runResult.id, {
      status: "failed",
      errorMessage: errorMessage,
    });

    return {
      id: runResult.id,
      status: "failed",
      executionTimeMs: 0,
      errorMessage: errorMessage,
    };
  }
}

/**
 * Rewrite URLs in action script to use local URL.
 *
 * @param params - Rewrite parameters.
 * @param params.actionScript - Original action script steps.
 * @param params.originalUrl - Original cloud URL to replace.
 * @param params.localUrl - Local URL to use.
 * @returns Action script with rewritten URLs.
 */
function rewriteActionScriptUrls(params: {
  actionScript: unknown[];
  originalUrl?: string;
  localUrl: string;
}): unknown[] {
  const { actionScript, originalUrl, localUrl } = params;

  if (!originalUrl) {
    return actionScript;
  }

  // Deep clone and replace URLs
  const serialized = JSON.stringify(actionScript);
  const rewritten = serialized.replace(new RegExp(escapeRegex(originalUrl), "g"), localUrl);
  return JSON.parse(rewritten) as unknown[];
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cancel an active execution.
 *
 * @param params - Cancel parameters.
 * @param params.runId - Run ID to cancel.
 * @returns Whether cancellation was successful.
 */
export function cancelExecution(params: { runId: string }): boolean {
  const process = activeProcesses.get(params.runId);

  if (!process) {
    return false;
  }

  // Kill the process
  process.process.kill("SIGTERM");

  // Update status
  process.status = "cancelled";
  activeProcesses.delete(params.runId);

  // Update storage
  const storage = getRunResultStorageService();
  storage.updateRunResult(params.runId, {
    status: "cancelled",
    errorMessage: "Execution cancelled by user.",
  });

  return true;
}

/**
 * List active executions.
 */
export function listActiveExecutions(): Array<{ runId: string; status: RunResultStatus }> {
  return Array.from(activeProcesses.entries()).map(([runId, process]) => ({
    runId: runId,
    status: process.status,
  }));
}
