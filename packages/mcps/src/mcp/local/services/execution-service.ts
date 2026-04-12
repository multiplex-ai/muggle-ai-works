/**
 * Execution service for managing electron-app processes.
 * Handles test script generation and replay via direct electron-app execution.
 *
 * Design principle: This service accepts full test case/script details
 * (already fetched via muggle-remote-* tools by the agent). No cloud calls here.
 * - Stores run results locally
 * - Replaces production URLs with localhost URLs
 */

import { spawn } from "child_process";
import * as fs from "fs/promises";
import * as os from "node:os";
import * as path from "path";

import { getConfig, getElectronAppDir, getElectronAppVersion } from "../../../shared/config.js";
import { getLogger } from "../../../shared/logger.js";
import type { TestCaseDetails, TestScriptDetails } from "../contracts/project-schemas.js";
import { getAuthService, getRunResultStorageService, getStorageService } from "./index.js";
import type { ILocalExecutionContext } from "./run-result-storage-service.js";
import type { RunResultStatus } from "./run-result-storage-service.js";

const logger = getLogger();

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
 * Electron process completion payload.
 */
interface IElectronExecutionResult {
  /** Process exit code. */
  exitCode: number;
  /** Captured stdout. */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
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
    throw new Error("Not authenticated. Please run muggle-remote-auth-login first.");
  }

  if (!authStatus.userId) {
    throw new Error("User ID not found in auth. Please re-authenticate.");
  }

  return authStatus.userId;
}

/**
 * Find and read the MCP server's package.json.
 * Handles both source and bundled environments by trying multiple paths.
 */
async function findPackageJsonAsync(): Promise<{
  version: string;
  muggleConfig: { electronAppVersion: string };
}> {
  const currentFileUrl = import.meta.url;
  const currentDir = path.dirname(new URL(currentFileUrl).pathname);

  const candidatePaths = [
    path.resolve(currentDir, "../../../package.json"),
    path.resolve(currentDir, "../package.json"),
    path.resolve(currentDir, "../../package.json"),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      const packageJsonRaw = await fs.readFile(candidatePath, "utf-8");
      const packageJson = JSON.parse(packageJsonRaw) as {
        name?: string;
        version?: string;
        muggleConfig?: { electronAppVersion?: string };
      };

      if (
        packageJson.name === "@muggleai/works" &&
        packageJson.version &&
        packageJson.muggleConfig?.electronAppVersion
      ) {
        return {
          version: packageJson.version,
          muggleConfig: { electronAppVersion: packageJson.muggleConfig.electronAppVersion },
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    `Could not find @muggleai/works package.json with required fields. Searched paths: ${candidatePaths.join(", ")}`
  );
}

/**
 * Read local execution environment details for upload metadata.
 */
async function getLocalExecutionContextBaseAsync(params: {
  runByUserId: string;
  originalUrl: string;
  productionUrl: string;
}): Promise<ILocalExecutionContext> {
  const packageJson = await findPackageJsonAsync();

  return {
    originalUrl: params.originalUrl,
    productionUrl: params.productionUrl,
    runByUserId: params.runByUserId,
    machineHostname: os.hostname(),
    osInfo: `${os.platform()} ${os.release()} ${os.arch()}`,
    electronAppVersion: packageJson.muggleConfig.electronAppVersion,
    mcpServerVersion: packageJson.version,
  };
}

/**
 * Build auth content for electron-app.
 */
function buildStudioAuthContent(): { accessToken: string; email: string; userId: string } {
  const authService = getAuthService();
  const authStatus = authService.getAuthStatus();
  const storedAuth = authService.loadStoredAuth();

  if (!authStatus.authenticated || !storedAuth) {
    throw new Error("Not authenticated. Please run muggle-remote-auth-login first.");
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

/**
 * Move test generation results to a persistent artifacts directory.
 * Uses sessions/{runId} so users can view action script with screenshots.
 *
 * @param params - Move parameters.
 * @param params.runId - Run ID.
 * @param params.generatedScriptPath - Path to the gen_*.json file from electron-app.
 * @returns Absolute path to the artifacts directory.
 */
async function moveResultsToArtifacts(params: {
  runId: string;
  generatedScriptPath: string;
}): Promise<string> {
  const storageService = getStorageService();
  const sessionsDir = storageService.getSessionsDir();
  const artifactsDir = path.join(sessionsDir, params.runId);
  const actionScriptPath = path.join(artifactsDir, "action-script.json");

  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.copyFile(params.generatedScriptPath, actionScriptPath);

  try {
    await fs.unlink(params.generatedScriptPath);
  } catch {
    // Ignore cleanup errors for temp file
  }

  return artifactsDir;
}

/**
 * Write execution logs (stdout/stderr) to the session artifacts directory.
 *
 * @param params - Write parameters.
 * @param params.runId - Run ID.
 * @param params.stdout - Captured stdout from electron-app.
 * @param params.stderr - Captured stderr from electron-app.
 */
async function writeExecutionLogs(params: {
  runId: string;
  stdout: string;
  stderr: string;
}): Promise<void> {
  const storageService = getStorageService();
  const sessionsDir = storageService.getSessionsDir();
  const artifactsDir = path.join(sessionsDir, params.runId);

  await fs.mkdir(artifactsDir, { recursive: true });

  const stdoutPath = path.join(artifactsDir, "stdout.log");
  const stderrPath = path.join(artifactsDir, "stderr.log");

  await Promise.all([
    fs.writeFile(stdoutPath, params.stdout, "utf-8"),
    fs.writeFile(stderrPath, params.stderr, "utf-8"),
  ]);

  logger.info("Wrote execution logs to artifacts directory", {
    runId: params.runId,
    artifactsDir: artifactsDir,
  });
}

/**
 * Resolve the electron-app binary path from config.
 * Throws a detailed error if the binary cannot be found.
 */
function getElectronAppPathOrThrow(): string {
  const config = getConfig();
  const electronAppPath = config.localQa.electronAppPath;

  if (!electronAppPath || electronAppPath.trim() === "") {
    const version = getElectronAppVersion();
    const versionDir = getElectronAppDir(version);
    const envPath = process.env.ELECTRON_APP_PATH;

    const errorLines = [
      "Electron app binary not found.",
      "",
      `  Expected version: ${version}`,
      `  Checked directory: ${versionDir}`,
    ];

    if (envPath) {
      errorLines.push(`  ELECTRON_APP_PATH: ${envPath} (not found or invalid)`);
    } else {
      errorLines.push("  ELECTRON_APP_PATH: (not set)");
    }

    errorLines.push("");
    errorLines.push("To fix this, run: muggle setup");
    errorLines.push("Or set ELECTRON_APP_PATH to the path of the MuggleAI executable.");

    throw new Error(errorLines.join("\n"));
  }

  return electronAppPath;
}

/**
 * Get a required string from an object field.
 */
function getRequiredStringField(params: {
  source: Record<string, unknown>;
  fieldName: string;
  sourceLabel: string;
}): string {
  const value = params.source[params.fieldName];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Missing required field '${params.fieldName}' in ${params.sourceLabel}. ` +
        "Please pass the full object from the corresponding muggle-remote-* get tool.",
    );
  }
  return value;
}

/**
 * Build a local action script for test generation (explore mode).
 */
function buildGenerationActionScript(params: {
  testCase: TestCaseDetails;
  localUrl: string;
  runId: string;
  localTestScriptId: string;
  ownerUserId: string;
}): Record<string, unknown> {
  const testCaseRecord = params.testCase as unknown as Record<string, unknown>;
  const projectId = getRequiredStringField({
    source: testCaseRecord,
    fieldName: "projectId",
    sourceLabel: "testCase",
  });
  const useCaseId = getRequiredStringField({
    source: testCaseRecord,
    fieldName: "useCaseId",
    sourceLabel: "testCase",
  });

  return {
    actionScriptId: params.localTestScriptId,
    actionScriptName: `Local Generation ${params.testCase.title}`,
    actionType: "UserDefined",
    actionParams: {
      type: "Test Script Generation Workflow",
      name: `Local Generation ${params.testCase.title}`,
      ownerId: params.ownerUserId,
      projectId: projectId,
      useCaseId: useCaseId,
      testCaseId: params.testCase.id,
      testScriptId: params.localTestScriptId,
      actionScriptId: params.localTestScriptId,
      workflowRunId: params.runId,
      url: params.localUrl,
      sharedTestMemoryId: "",
    },
    goal: params.testCase.goal,
    url: params.localUrl,
    description: params.testCase.title,
    precondition: params.testCase.precondition ?? "",
    instructions: params.testCase.instructions ?? "",
    expectedResult: params.testCase.expectedResult,
    steps: [],
    ownerId: params.ownerUserId,
    createdAt: Date.now(),
    isRemoteScript: false,
    status: "active",
  };
}

/**
 * Build a local action script for test replay (engine mode).
 * @param params.testScript - Test script metadata (from muggle-remote-test-script-get).
 * @param params.actionScript - Action script steps (from muggle-remote-action-script-get).
 * @param params.localUrl - Local URL to test against.
 * @param params.runId - Run ID for this execution.
 * @param params.ownerUserId - Owner user ID.
 */
function buildReplayActionScript(params: {
  testScript: TestScriptDetails;
  actionScript: unknown[];
  localUrl: string;
  runId: string;
  ownerUserId: string;
}): Record<string, unknown> {
  const testScriptRecord = params.testScript as unknown as Record<string, unknown>;
  const projectId = getRequiredStringField({
    source: testScriptRecord,
    fieldName: "projectId",
    sourceLabel: "testScript",
  });
  const useCaseId = getRequiredStringField({
    source: testScriptRecord,
    fieldName: "useCaseId",
    sourceLabel: "testScript",
  });

  const rewrittenActionScript = rewriteActionScriptUrls({
    actionScript: params.actionScript,
    originalUrl: params.testScript.url,
    localUrl: params.localUrl,
  });

  return {
    actionScriptId: params.testScript.actionScriptId,
    actionScriptName: params.testScript.name,
    actionType: "UserDefined",
    actionParams: {
      type: "Test Script Replay Workflow",
      name: params.testScript.name,
      ownerId: params.ownerUserId,
      projectId: projectId,
      useCaseId: useCaseId,
      testCaseId: params.testScript.testCaseId,
      testScriptId: params.testScript.id,
      workflowRunId: params.runId,
      sharedTestMemoryId: "",
    },
    goal: params.testScript.name,
    url: params.localUrl,
    description: params.testScript.name,
    precondition: "",
    expectedResult: "Replay completes without critical failures.",
    steps: rewrittenActionScript,
    ownerId: params.ownerUserId,
    createdAt: Date.now(),
    isRemoteScript: true,
    status: "active",
  };
}

/**
 * Spawn electron-app in the requested mode and wait for completion.
 */
async function executeElectronAppAsync(params: {
  runId: string;
  runType: "generation" | "replay";
  scriptFilePath: string;
  authFilePath: string;
  timeoutMs: number;
  showUi?: boolean;
  freshSession?: boolean;
}): Promise<IElectronExecutionResult> {
  const mode = params.runType === "generation" ? "explore" : "engine";
  const electronAppPath = getElectronAppPathOrThrow();
  const spawnArgs = [mode, params.scriptFilePath, "", params.authFilePath];

  if (params.showUi) {
    spawnArgs.push("--show-ui");
  }

  if (params.freshSession) {
    spawnArgs.push("--fresh-session");
  }

  logger.info("Spawning electron-app for local execution", {
    runId: params.runId,
    mode: mode,
    electronAppPath: electronAppPath,
    spawnArgs: spawnArgs,
  });

  const electronEnv = { ...process.env };
  delete electronEnv.ELECTRON_RUN_AS_NODE;

  const child = spawn(electronAppPath, spawnArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    env: electronEnv,
    cwd: path.dirname(electronAppPath),
  });

  const processInfo: IInternalExecutionProcess = {
    runId: params.runId,
    process: child,
    status: "running",
    startedAt: Date.now(),
    capturedStdout: "",
    capturedStderr: "",
  };
  activeProcesses.set(params.runId, processInfo);

  return await new Promise<IElectronExecutionResult>((resolve, reject) => {
    let settled = false;

    const finalize = (result: { ok: boolean; payload: IElectronExecutionResult | Error }) => {
      if (settled) {
        return;
      }
      settled = true;

      if (processInfo.timeoutTimer) {
        clearTimeout(processInfo.timeoutTimer);
      }
      activeProcesses.delete(params.runId);

      if (result.ok) {
        resolve(result.payload as IElectronExecutionResult);
      } else {
        reject(result.payload as Error);
      }
    };

    processInfo.timeoutTimer = setTimeout(() => {
      processInfo.process.kill("SIGTERM");
      finalize({
        ok: false,
        payload: new Error(
          `Electron execution timed out after ${params.timeoutMs}ms.\n` +
            `STDOUT:\n${processInfo.capturedStdout}\n` +
            `STDERR:\n${processInfo.capturedStderr}`,
        ),
      });
    }, params.timeoutMs);

    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        processInfo.capturedStdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        processInfo.capturedStderr += chunk.toString();
      });
    }

    child.on("error", (error) => {
      finalize({
        ok: false,
        payload: new Error(`Failed to start electron-app: ${error.message}`),
      });
    });

    child.on("close", (code, signal) => {
      const exitCode = code ?? -1;
      if (signal) {
        finalize({
          ok: false,
          payload: new Error(
            `Electron execution terminated by signal ${signal}.\n` +
              `STDOUT:\n${processInfo.capturedStdout}\n` +
              `STDERR:\n${processInfo.capturedStderr}`,
          ),
        });
        return;
      }

      finalize({
        ok: true,
        payload: {
          exitCode: exitCode,
          stdout: processInfo.capturedStdout,
          stderr: processInfo.capturedStderr,
        },
      });
    });
  });
}

// ========================================
// Main Execution Functions
// ========================================

/**
 * Execute test script generation for a test case.
 *
 * Test case details should be fetched via muggle-remote-test-case-get before calling this.
 *
 * @param params - Execution parameters.
 * @param params.testCase - Test case details from muggle-remote-test-case-get.
 * @param params.localUrl - Local URL to test against.
 * @param params.timeoutMs - Optional timeout in milliseconds.
 * @param params.showUi - Optional flag to show electron-app UI during execution.
 * @returns Run result with generated script info.
 */
export async function executeTestGeneration(params: {
  testCase: TestCaseDetails;
  localUrl: string;
  timeoutMs?: number;
  showUi?: boolean;
  freshSession?: boolean;
}): Promise<ILocalRunResult> {
  const { testCase, localUrl } = params;
  const timeoutMs = params.timeoutMs ?? 300000;

  // Verify authentication (authContent will be used when electron-app integration is complete)
  const userId = getAuthenticatedUserId(); // Throws if not authenticated
  const authContent = buildStudioAuthContent();
  if (!testCase.url) {
    throw new Error("Missing required testCase.url for local run upload metadata");
  }

  const localExecutionContextBase = await getLocalExecutionContextBaseAsync({
    runByUserId: userId,
    originalUrl: localUrl,
    productionUrl: testCase.url,
  });

  // Initialize run result storage
  const storage = getRunResultStorageService();
  const runResult = storage.createRunResult({
    runType: "generation",
    cloudTestCaseId: testCase.id,
    projectId: testCase.projectId,
    useCaseId: testCase.useCaseId,
    localUrl: localUrl,
    productionUrl: testCase.url,
    localExecutionContext: localExecutionContextBase,
  });

  try {
    // Create local test script record
    const localTestScript = storage.createTestScript({
      name: `Script for ${testCase.title}`,
      url: localUrl,
      cloudTestCaseId: testCase.id,
      goal: testCase.goal,
    });

    const runId = runResult.id;
    const startedAt = Date.now();

    const actionScript = buildGenerationActionScript({
      testCase: testCase,
      localUrl: localUrl,
      runId: runId,
      localTestScriptId: localTestScript.id,
      ownerUserId: authContent.userId,
    });

    // Write temp files
    const inputFilePath = await writeTempFile({
      filename: `${runId}_input.json`,
      data: actionScript,
    });
    const authFilePath = await writeTempFile({
      filename: `${runId}_auth.json`,
      data: authContent,
    });

    try {
      const executionResult = await executeElectronAppAsync({
        runId: runId,
        runType: "generation",
        scriptFilePath: inputFilePath,
        authFilePath: authFilePath,
        timeoutMs: timeoutMs,
        showUi: params.showUi,
        freshSession: params.freshSession,
      });

      const completedAt = Date.now();
      const executionTimeMs = completedAt - startedAt;

      // Write execution logs to artifacts directory (always, regardless of success/failure)
      await writeExecutionLogs({
        runId: runId,
        stdout: executionResult.stdout,
        stderr: executionResult.stderr,
      });

      if (executionResult.exitCode !== 0) {
        const failureMessage =
          `Electron exited with code ${executionResult.exitCode}.\n` +
          `STDOUT:\n${executionResult.stdout}\n` +
          `STDERR:\n${executionResult.stderr}`;
        storage.updateRunResult(runId, {
          status: "failed",
          testScriptId: localTestScript.id,
          executionTimeMs: executionTimeMs,
          errorMessage: failureMessage,
          localExecutionContext: {
            ...localExecutionContextBase,
            localExecutionCompletedAt: completedAt,
          },
        });
        storage.updateTestScript(localTestScript.id, {
          status: "failed",
        });
        return {
          id: runId,
          testScriptId: localTestScript.id,
          status: "failed",
          executionTimeMs: executionTimeMs,
          errorMessage: failureMessage,
        };
      }

      const generatedScriptPath = path.join(
        path.dirname(inputFilePath),
        `gen_${path.basename(inputFilePath)}`,
      );
      const generatedScriptRaw = await fs.readFile(generatedScriptPath, "utf-8");
      const generatedScript = JSON.parse(generatedScriptRaw) as Record<string, unknown>;
      const generatedSteps = generatedScript.steps;
      if (!Array.isArray(generatedSteps)) {
        throw new Error(
          `Generated script does not contain a valid 'steps' array. File: ${generatedScriptPath}`,
        );
      }
      const generatedSummaryStep = generatedScript.summaryStep;

      storage.updateTestScript(localTestScript.id, {
        status: "generated",
        actionScript: generatedSteps,
        summaryStep: generatedSummaryStep,
      });

      const artifactsDir = await moveResultsToArtifacts({
        runId: runId,
        generatedScriptPath: generatedScriptPath,
      });
      storage.updateRunResult(runId, {
        status: "passed",
        testScriptId: localTestScript.id,
        executionTimeMs: executionTimeMs,
        artifactsDir: artifactsDir,
        localExecutionContext: {
          ...localExecutionContextBase,
          localExecutionCompletedAt: completedAt,
        },
      });

      return {
        id: runId,
        testScriptId: localTestScript.id,
        status: "passed",
        executionTimeMs: executionTimeMs,
      };
    } finally {
      await cleanupTempFiles({
        filePaths: [inputFilePath, authFilePath],
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const completedAt = Date.now();

    storage.updateRunResult(runResult.id, {
      status: "failed",
      errorMessage: errorMessage,
      localExecutionContext: {
        ...localExecutionContextBase,
        localExecutionCompletedAt: completedAt,
      },
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
 * Test script metadata should be fetched via muggle-remote-test-script-get,
 * and actionScript content via muggle-remote-action-script-get before calling this.
 *
 * @param params - Execution parameters.
 * @param params.testScript - Test script metadata from muggle-remote-test-script-get.
 * @param params.actionScript - Action script steps from muggle-remote-action-script-get.
 * @param params.localUrl - Local URL to test against.
 * @param params.timeoutMs - Optional timeout in milliseconds.
 * @param params.showUi - Optional flag to show electron-app UI during execution.
 * @returns Run result.
 */
export async function executeReplay(params: {
  testScript: TestScriptDetails;
  actionScript: unknown[];
  localUrl: string;
  timeoutMs?: number;
  showUi?: boolean;
  freshSession?: boolean;
}): Promise<ILocalRunResult> {
  const { testScript, actionScript, localUrl } = params;
  const timeoutMs = params.timeoutMs ?? 180000;

  // Verify authentication (authContent will be used when electron-app integration is complete)
  const userId = getAuthenticatedUserId(); // Throws if not authenticated
  const authContent = buildStudioAuthContent();
  if (!testScript.url) {
    throw new Error("Missing required testScript.url for local run upload metadata");
  }

  const localExecutionContextBase = await getLocalExecutionContextBaseAsync({
    runByUserId: userId,
    originalUrl: localUrl,
    productionUrl: testScript.url,
  });

  // Initialize run result storage
  const storage = getRunResultStorageService();
  const runResult = storage.createRunResult({
    runType: "replay",
    cloudTestCaseId: testScript.testCaseId,
    projectId: testScript.projectId,
    useCaseId: testScript.useCaseId,
    localUrl: localUrl,
    productionUrl: testScript.url,
    localExecutionContext: localExecutionContextBase,
  });

  try {
    const runId = runResult.id;
    const startedAt = Date.now();

    const builtActionScript = buildReplayActionScript({
      testScript: testScript,
      actionScript: actionScript,
      localUrl: localUrl,
      runId: runId,
      ownerUserId: authContent.userId,
    });

    // Write temp files
    const inputFilePath = await writeTempFile({
      filename: `${runId}_input.json`,
      data: builtActionScript,
    });
    const authFilePath = await writeTempFile({
      filename: `${runId}_auth.json`,
      data: authContent,
    });

    try {
      const executionResult = await executeElectronAppAsync({
        runId: runId,
        runType: "replay",
        scriptFilePath: inputFilePath,
        authFilePath: authFilePath,
        timeoutMs: timeoutMs,
        showUi: params.showUi,
        freshSession: params.freshSession,
      });

      const completedAt = Date.now();
      const executionTimeMs = completedAt - startedAt;

      // Write execution logs to artifacts directory (always, regardless of success/failure)
      await writeExecutionLogs({
        runId: runId,
        stdout: executionResult.stdout,
        stderr: executionResult.stderr,
      });

      if (executionResult.exitCode !== 0) {
        const failureMessage =
          `Electron exited with code ${executionResult.exitCode}.\n` +
          `STDOUT:\n${executionResult.stdout}\n` +
          `STDERR:\n${executionResult.stderr}`;
        storage.updateRunResult(runId, {
          status: "failed",
          executionTimeMs: executionTimeMs,
          errorMessage: failureMessage,
          localExecutionContext: {
            ...localExecutionContextBase,
            localExecutionCompletedAt: completedAt,
          },
        });
        return {
          id: runId,
          status: "failed",
          executionTimeMs: executionTimeMs,
          errorMessage: failureMessage,
        };
      }

      const artifactsDir = path.join(getStorageService().getSessionsDir(), runId);
      storage.updateRunResult(runId, {
        status: "passed",
        executionTimeMs: executionTimeMs,
        artifactsDir: artifactsDir,
        localExecutionContext: {
          ...localExecutionContextBase,
          localExecutionCompletedAt: completedAt,
        },
      });
      return {
        id: runId,
        status: "passed",
        executionTimeMs: executionTimeMs,
      };
    } finally {
      await cleanupTempFiles({
        filePaths: [inputFilePath, authFilePath],
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const completedAt = Date.now();

    storage.updateRunResult(runResult.id, {
      status: "failed",
      errorMessage: errorMessage,
      localExecutionContext: {
        ...localExecutionContextBase,
        localExecutionCompletedAt: completedAt,
      },
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
