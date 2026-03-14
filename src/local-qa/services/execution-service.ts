/**
 * Execution service for managing electron-app processes.
 * Handles test script generation and replay via direct electron-app execution.
 */

import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import * as fs from "fs/promises";
import * as path from "path";

import { ulid } from "ulid";

import { getConfig } from "../../shared/config.js";
import type {
  IExecutionProcess,
  IExecutionResult,
  ILocalRunResult,
  ILocalTestCase,
  ILocalTestScript,
  ILocalWorkflowRun,
} from "../types/index.js";
import {
  LocalRunStatus,
  LocalRunType,
  LocalTestScriptStatus,
  LocalWorkflowRunStatus,
} from "../types/index.js";
import { getAuthService, getProjectStorageService } from "./index.js";

/**
 * Studio auth info for electron-app.
 */
interface IStudioAuthInfo {
  /** Access token. */
  accessToken: string;
  /** User email. */
  email: string;
  /** User ID. */
  userId: string;
}

/**
 * Secret option for action scripts.
 */
interface ISecretOption {
  /** Secret ID. */
  id: string;
  /** Secret name. */
  secretName: string;
  /** Secret description. */
  description: string;
  /** Secret source. */
  source?: "agent" | "user";
}

/**
 * Workflow file metadata for action scripts.
 */
interface IWorkflowFileMetadata {
  /** File ID. */
  id: string;
  /** File path. */
  filePath: string;
  /** File description. */
  description: string;
  /** File tags. */
  tags?: string[];
}

/**
 * Map local workflow files to workflow file metadata for action scripts.
 * @param files - Local workflow files.
 * @returns Workflow file metadata array.
 */
function mapWorkflowFilesToMetadata (files: Array<{
  id: string;
  localPath: string;
  description: string;
  tags?: string[];
}>): IWorkflowFileMetadata[] {
  return files.map((f) => ({
    id: f.id,
    filePath: f.localPath,
    description: f.description,
    tags: f.tags,
  }));
}

/**
 * Get the authenticated user ID from the auth file.
 * @returns The user ID or throws if not authenticated.
 */
function getAuthenticatedUserId (): string {
  const authService = getAuthService();
  const authStatus = authService.getAuthStatus();

  if (!authStatus.authenticated) {
    throw new Error("Not authenticated. Please run muggle_auth_login first.");
  }

  if (!authStatus.userId) {
    throw new Error("User ID not found in auth. Please re-authenticate.");
  }

  return authStatus.userId;
}

/**
 * Build studio auth content from stored local authentication.
 * @returns Auth content compatible with electron-app runtime.
 */
function buildStudioAuthContent (): IStudioAuthInfo {
  const authService = getAuthService();
  const authStatus = authService.getAuthStatus();
  const storedAuth = authService.loadStoredAuth();

  if (!authStatus.authenticated || !storedAuth) {
    throw new Error("Not authenticated. Please run muggle_auth_login first.");
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

/**
 * Convert local secrets to secret option metadata for action scripts.
 * @param params - Conversion parameters.
 * @returns Secret option metadata.
 */
function buildSecretOptionsFromLocalSecrets (params: {
  localSecrets: Array<{
    id: string;
    secretName: string;
    description: string;
    source?: "agent" | "user";
  }>;
}): ISecretOption[] | undefined {
  if (params.localSecrets.length === 0) {
    return undefined;
  }

  return params.localSecrets.map((localSecret) => ({
    id: localSecret.id,
    secretName: localSecret.secretName,
    description: localSecret.description,
    source: localSecret.source,
  }));
}

/** Default timeout for test generation (5 minutes). */
const DEFAULT_GENERATION_TIMEOUT_MS = 300000;

/** Default timeout for replay (3 minutes). */
const DEFAULT_REPLAY_TIMEOUT_MS = 180000;

/**
 * Extended execution process with ChildProcess.
 */
interface IInternalExecutionProcess extends IExecutionProcess {
  /** The child process. */
  process: ChildProcess;
  /** Timeout timer. */
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

/** Map of active execution processes by run ID. */
const activeProcesses: Map<string, IInternalExecutionProcess> = new Map();

/**
 * Generate a run ID with prefix.
 * @returns A ULID with run_ prefix.
 */
function generateRunId (): string {
  return `run_${ulid()}`;
}

/**
 * Ensure the temp directory exists.
 * @returns The temp directory path.
 */
async function ensureTempDir (): Promise<string> {
  const config = getConfig();
  const tempDir = config.localQa.tempDir;
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
}

/**
 * Write a JSON file to the temp directory.
 * @param params - The parameters.
 * @param params.filename - The filename.
 * @param params.data - The data to write.
 * @returns The full path to the written file.
 */
async function writeTempFile (params: { filename: string; data: unknown; }): Promise<string> {
  const { filename, data } = params;
  const tempDir = await ensureTempDir();
  const filePath = path.join(tempDir, filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

/**
 * Read a JSON file from the temp directory.
 * @param filePath - The file path.
 * @returns The parsed JSON data or null if not found.
 */
async function readTempFile (filePath: string): Promise<unknown | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Read generated action script written by electron-app (gen_ prefix fallback file).
 * @param params - File lookup parameters.
 * @returns Parsed generated action script, or null when unavailable.
 */
async function readGeneratedActionScriptFile (params: {
  inputFilePath: string;
}): Promise<unknown | null> {
  const generatedFilePath = path.join(
    path.dirname(params.inputFilePath),
    `gen_${path.basename(params.inputFilePath)}`,
  );
  return readTempFile(generatedFilePath);
}

/**
 * Studio returned result status values that indicate failure.
 */
const FAILED_STUDIO_STATUSES = ["goal_not_achievable", "failed", "error", "timeout", "cancelled"];

/**
 * Check if the workflow run indicates a failure based on studioReturnedResult.
 * @param params - The parameters.
 * @param params.projectId - The project ID.
 * @param params.workflowRunId - The workflow run ID.
 * @returns Object with success status and error message if failed.
 */
async function checkWorkflowRunResult (params: {
  projectId: string;
  workflowRunId: string;
}): Promise<{ success: boolean; error?: string; }> {
  const { projectId, workflowRunId } = params;
  const config = getConfig();

  const workflowRunPath = path.join(
    config.localQa.projectsDir,
    projectId,
    "workflow-runs",
    `${workflowRunId}.json`,
  );

  try {
    const content = await fs.readFile(workflowRunPath, "utf-8");
    const workflowRun = JSON.parse(content) as {
      studioReturnedResult?: {
        status?: string;
        summary?: string;
        error?: string;
      };
    };

    if (!workflowRun.studioReturnedResult) {
      return { success: true };
    }

    const studioResult = workflowRun.studioReturnedResult;
    const status = studioResult.status?.toLowerCase() ?? "";

    if (FAILED_STUDIO_STATUSES.includes(status)) {
      const errorMessage =
        studioResult.error ?? studioResult.summary ?? `Test failed with status: ${status}`;
      return { success: false, error: errorMessage };
    }

    return { success: true };
  } catch {
    return { success: true };
  }
}

/**
 * Extract generated action steps from electron-app output.
 * @param actionScriptResult - Raw action script payload.
 * @returns Generated action steps, when present.
 */
function extractGeneratedActionSteps (actionScriptResult: unknown): unknown[] | undefined {
  if (Array.isArray(actionScriptResult)) {
    return actionScriptResult;
  }

  if (actionScriptResult === null || typeof actionScriptResult !== "object") {
    return undefined;
  }

  const actionScriptResultRecord = actionScriptResult as Record<string, unknown>;
  const topLevelSteps = actionScriptResultRecord.steps;
  if (Array.isArray(topLevelSteps)) {
    return topLevelSteps;
  }

  const outputSteps = actionScriptResultRecord.output;
  if (Array.isArray(outputSteps)) {
    return outputSteps;
  }

  return undefined;
}

/**
 * Ensure a generated test script is persisted locally with a stable ID.
 * @param params - Persistence parameters.
 * @returns The persisted test script ID.
 */
function ensureGeneratedTestScript (params: {
  projectId: string;
  testCase: ILocalTestCase;
  projectUrl: string;
  testScriptId: string;
  actionScriptId: string;
  actionScriptResult: unknown;
}): string {
  const { projectId, testCase, projectUrl, testScriptId, actionScriptId, actionScriptResult } =
    params;
  const storageService = getProjectStorageService();
  const existingTestScript = storageService.getTestScript({
    projectId: projectId,
    testScriptId: testScriptId,
  });

  if (!existingTestScript) {
    storageService.createTestScript({
      projectId: projectId,
      useCaseId: testCase.useCaseId,
      testCaseId: testCase.id,
      url: projectUrl,
      name: testCase.title,
      testScriptId: testScriptId,
    });
  }

  const actionScriptSteps = extractGeneratedActionSteps(actionScriptResult);
  if (actionScriptResult !== null && actionScriptResult !== undefined) {
    storageService.saveActionScript({
      projectId: projectId,
      testScriptId: testScriptId,
      actionScript: actionScriptResult,
    });
  }

  storageService.updateTestScript({
    projectId: projectId,
    testScriptId: testScriptId,
    updates: {
      goal: testCase.goal,
      description: testCase.description,
      precondition: testCase.precondition,
      expectedResult: testCase.expectedResult,
      actionScriptId: actionScriptId,
      actionScript: actionScriptSteps,
      status: LocalTestScriptStatus.GENERATED,
    },
  });

  return testScriptId;
}

/**
 * Clean up temp files for a run.
 * @param params - The parameters.
 * @param params.filePaths - The file paths to clean up.
 */
async function cleanupTempFiles (params: { filePaths: string[]; }): Promise<void> {
  const { filePaths } = params;
  try {
    await Promise.all(
      filePaths.map(async (filePath) =>
        fs.unlink(filePath).catch(() => {
          /* ignore */
        }),
      ),
    );
  } catch {
    /* ignore cleanup errors */
  }
}

/**
 * Build action script for test generation.
 * @param params - The parameters.
 * @returns The action script object.
 */
function buildGenerationActionScript (params: {
  projectSecretOptions?: ISecretOption[];
  projectWorkflowFiles?: IWorkflowFileMetadata[];
  testCase: ILocalTestCase;
  projectUrl: string;
  userId: string;
}): {
  actionScript: Record<string, unknown>;
  actionScriptId: string;
  testScriptId: string;
  workflowRunId: string;
  actionParams: Record<string, unknown>;
} {
  const { projectSecretOptions, projectWorkflowFiles, testCase, projectUrl, userId } = params;
  const actionScriptId = `as_${ulid()}`;
  const testScriptId = `ts_${ulid()}`;
  const workflowRunId = `local_${ulid()}`;
  const actionParams = {
    type: "Test Script Generation Workflow",
    name: testCase.title,
    projectId: testCase.projectId,
    useCaseId: testCase.useCaseId,
    testCaseId: testCase.id,
    testScriptId: testScriptId,
    actionScriptId: actionScriptId,
    workflowRunId: workflowRunId,
    url: projectUrl,
    sharedTestMemoryId: `stm_local_${ulid()}`,
    workflowFiles: projectWorkflowFiles,
    ownerId: userId,
  };

  return {
    actionScript: {
      actionScriptId: actionScriptId,
      actionScriptName: testCase.title,
      actionType: "Exploratory",
      actionParams: actionParams,
      goal: testCase.expectedResult ?? testCase.title,
      url: projectUrl,
      description: testCase.description ?? "",
      precondition: testCase.precondition,
      expectedResult: testCase.expectedResult ?? "",
      steps: [],
      ownerId: userId,
      createdAt: Date.now(),
      isRemoteScript: false,
      status: "active",
      secretOptions: projectSecretOptions,
    },
    actionScriptId: actionScriptId,
    testScriptId: testScriptId,
    workflowRunId: workflowRunId,
    actionParams: actionParams,
  };
}

/**
 * Build action script for replay.
 * @param params - The parameters.
 * @returns The action script object.
 */
function buildReplayActionScript (params: {
  projectSecretOptions?: ISecretOption[];
  projectWorkflowFiles?: IWorkflowFileMetadata[];
  testScript: ILocalTestScript;
  userId: string;
}): {
  actionScript: Record<string, unknown>;
  actionScriptId: string;
  testScriptId: string;
  workflowRunId: string;
  actionParams: Record<string, unknown>;
} {
  const { projectSecretOptions, projectWorkflowFiles, testScript, userId } = params;
  const actionScriptId = testScript.actionScriptId ?? `as_${ulid()}`;
  const workflowRunId = `local_${ulid()}`;
  const actionParams = {
    type: "Test Script Replay Workflow",
    name: testScript.name,
    projectId: testScript.projectId,
    useCaseId: testScript.useCaseId,
    testCaseId: testScript.testCaseId,
    testScriptId: testScript.id,
    workflowRunId: workflowRunId,
    sharedTestMemoryId: `stm_local_${ulid()}`,
    workflowFiles: projectWorkflowFiles,
    ownerId: userId,
  };

  return {
    actionScript: {
      actionScriptId: actionScriptId,
      actionScriptName: testScript.name,
      actionType: "UserDefined",
      actionParams: actionParams,
      goal: testScript.goal ?? testScript.name,
      url: testScript.url ?? "",
      description: testScript.description ?? "",
      precondition: testScript.precondition,
      expectedResult: testScript.expectedResult ?? "",
      steps: testScript.actionScript ?? [],
      ownerId: userId,
      createdAt: testScript.createdAt,
      isRemoteScript: false,
      status: "active",
      secretOptions: projectSecretOptions,
    },
    actionScriptId: actionScriptId,
    testScriptId: testScript.id,
    workflowRunId: workflowRunId,
    actionParams: actionParams,
  };
}

/**
 * Build a local workflow run record.
 * @param params - The parameters.
 * @returns The workflow run record.
 */
function buildLocalWorkflowRun (params: {
  projectId: string;
  workflowRunId: string;
  ownerId: string;
  taskDef: Record<string, unknown>;
}): ILocalWorkflowRun {
  const { projectId, workflowRunId, ownerId, taskDef } = params;
  const now = Date.now();

  return {
    id: workflowRunId,
    projectId: projectId,
    workflowRuntimeId: workflowRunId,
    ownerId: ownerId,
    status: LocalWorkflowRunStatus.RUNNING,
    progress: 0,
    taskDef: taskDef,
    createdAt: now,
    startedAt: now,
  };
}

/**
 * Execute the electron-app with the given parameters.
 * @param params - The parameters.
 * @returns The execution process info.
 */
async function spawnElectronApp (params: {
  runId: string;
  projectId: string;
  entityId: string;
  runType: LocalRunType;
  runMode: "explore" | "engine";
  inputFilePath: string;
  mutationFilePath: string;
  outputFilePath: string;
  authFilePath: string;
  additionalArgs?: string[];
  timeoutMs: number;
}): Promise<IInternalExecutionProcess> {
  const {
    runId,
    projectId,
    entityId,
    runType,
    runMode,
    inputFilePath,
    mutationFilePath,
    outputFilePath,
    authFilePath,
    additionalArgs,
    timeoutMs,
  } = params;

  const config = getConfig();
  const electronAppPath = config.localQa.electronAppPath;
  if (!electronAppPath) {
    throw new Error(
      "Electron-app not found. Run 'muggle-mcp setup' to install, " +
      "or set ELECTRON_APP_PATH environment variable.",
    );
  }

  const args = [
    runMode,
    inputFilePath,
    mutationFilePath,
    authFilePath,
    "--no-sandbox",
    ...(additionalArgs ?? []),
  ];

  const childProcessEnv: NodeJS.ProcessEnv = {
    ...process.env,
    MUGGLE_LOCAL_DATA_DIR: config.localQa.dataDir,
  };
  delete childProcessEnv.ELECTRON_RUN_AS_NODE;
  delete childProcessEnv.ELECTRON_NO_ASAR;

  const childProcess = spawn(electronAppPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    env: childProcessEnv,
  });

  if (!childProcess.pid) {
    throw new Error("Failed to spawn electron-app process");
  }

  const executionProcess: IInternalExecutionProcess = {
    runId: runId,
    projectId: projectId,
    entityId: entityId,
    runType: runType,
    process: childProcess,
    pid: childProcess.pid,
    startedAt: Date.now(),
    status: LocalRunStatus.RUNNING,
    inputFilePath: inputFilePath,
    outputFilePath: outputFilePath,
  };

  const timeoutTimer = setTimeout(() => {
    handleTimeout({ executionProcess: executionProcess });
  }, timeoutMs);

  executionProcess.timeoutTimer = timeoutTimer;

  activeProcesses.set(runId, executionProcess);

  return executionProcess;
}

/**
 * Handle execution timeout.
 * @param params - The parameters.
 * @param params.executionProcess - The execution process.
 */
function handleTimeout (params: { executionProcess: IInternalExecutionProcess; }): void {
  const { executionProcess } = params;

  if (executionProcess.status === LocalRunStatus.RUNNING) {
    executionProcess.status = LocalRunStatus.FAILED;
    try {
      executionProcess.process.kill("SIGTERM");
    } catch {
      /* ignore kill errors */
    }
  }
}

/**
 * Wait for the electron-app process to complete.
 * @param params - The parameters.
 * @param params.executionProcess - The execution process.
 * @returns The execution result.
 */
async function waitForCompletion (params: {
  executionProcess: IInternalExecutionProcess;
}): Promise<IExecutionResult> {
  const { executionProcess } = params;

  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";

    executionProcess.process.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    executionProcess.process.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    executionProcess.process.on("close", async (code) => {
      if (executionProcess.timeoutTimer) {
        clearTimeout(executionProcess.timeoutTimer);
      }

      activeProcesses.delete(executionProcess.runId);

      if (executionProcess.status === LocalRunStatus.CANCELLED) {
        resolve({
          success: false,
          status: "FAILURE",
          summary: "Execution was cancelled",
          error: "Cancelled by user",
        });
        return;
      }

      if (code !== 0 || executionProcess.status === LocalRunStatus.FAILED) {
        executionProcess.status = LocalRunStatus.FAILED;
        resolve({
          success: false,
          status: "FAILURE",
          summary: "Execution failed",
          error: stderr || `Process exited with code ${code}`,
        });
        return;
      }

      const outputData = await readTempFile(executionProcess.outputFilePath);
      executionProcess.status = LocalRunStatus.PASSED;

      resolve({
        success: true,
        status: "SUCCESS",
        summary: "Execution completed successfully",
        actionScript: outputData,
      });
    });

    executionProcess.process.on("error", (error) => {
      if (executionProcess.timeoutTimer) {
        clearTimeout(executionProcess.timeoutTimer);
      }

      activeProcesses.delete(executionProcess.runId);
      executionProcess.status = LocalRunStatus.FAILED;

      resolve({
        success: false,
        status: "FAILURE",
        summary: "Execution error",
        error: error.message,
      });
    });
  });
}

/**
 * Execute test script generation for a test case.
 * @param params - The parameters.
 * @param params.projectId - The project ID.
 * @param params.testCaseId - The test case ID.
 * @param params.timeoutMs - Optional timeout in milliseconds.
 * @returns The run result.
 */
export async function executeTestGeneration (params: {
  projectId: string;
  testCaseId: string;
  timeoutMs?: number;
}): Promise<ILocalRunResult> {
  const { projectId, testCaseId, timeoutMs = DEFAULT_GENERATION_TIMEOUT_MS } = params;

  const storageService = getProjectStorageService();

  const project = storageService.getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const testCase = storageService.getTestCase({
    projectId: projectId,
    testCaseId: testCaseId,
  });
  if (!testCase) {
    throw new Error(`Test case not found: ${testCaseId}`);
  }

  const useCase = storageService.getUseCase({
    projectId: projectId,
    useCaseId: testCase.useCaseId,
  });
  if (!useCase) {
    throw new Error(`Use case not found: ${testCase.useCaseId}`);
  }

  const userId = getAuthenticatedUserId();
  const authContent = buildStudioAuthContent();

  const localSecretOptions = buildSecretOptionsFromLocalSecrets({
    localSecrets: storageService.listSecrets(projectId),
  });
  const localWorkflowFiles = storageService.resolveWorkflowFilesForExecution({
    projectId: projectId,
    useCaseId: testCase.useCaseId,
    testCaseId: testCase.id,
  });
  const workflowFileMetadata = mapWorkflowFilesToMetadata(localWorkflowFiles);

  const runId = generateRunId();
  const actionScriptBuild = buildGenerationActionScript({
    projectSecretOptions: localSecretOptions,
    projectWorkflowFiles: workflowFileMetadata,
    testCase: testCase,
    projectUrl: project.url,
    userId: userId,
  });
  const localWorkflowRun = buildLocalWorkflowRun({
    projectId: projectId,
    workflowRunId: actionScriptBuild.workflowRunId,
    ownerId: userId,
    taskDef: actionScriptBuild.actionParams,
  });
  storageService.createWorkflowRun(localWorkflowRun);

  const inputFilePath = await writeTempFile({
    filename: `${runId}_input.json`,
    data: actionScriptBuild.actionScript,
  });
  const mutationFilePath = await writeTempFile({
    filename: `${runId}_mutations.json`,
    data: [],
  });
  const authFilePath = await writeTempFile({
    filename: `${runId}_auth.json`,
    data: authContent,
  });

  const outputFilePath = path.join(await ensureTempDir(), `${runId}_output.json`);

  const executionProcess = await spawnElectronApp({
    runId: runId,
    projectId: projectId,
    entityId: testCaseId,
    runType: LocalRunType.GENERATION,
    runMode: "explore",
    inputFilePath: inputFilePath,
    mutationFilePath: mutationFilePath,
    outputFilePath: outputFilePath,
    authFilePath: authFilePath,
    timeoutMs: timeoutMs,
  });

  const startedAt = executionProcess.startedAt;

  const result = await waitForCompletion({ executionProcess: executionProcess });

  const completedAt = Date.now();

  let actionScriptResult = result.actionScript;
  if (actionScriptResult === null || actionScriptResult === undefined) {
    actionScriptResult = await readGeneratedActionScriptFile({
      inputFilePath: inputFilePath,
    });
  }

  const workflowResult = await checkWorkflowRunResult({
    projectId: projectId,
    workflowRunId: actionScriptBuild.workflowRunId,
  });

  let finalSuccess = result.success && workflowResult.success;
  let finalError = result.error ?? workflowResult.error;

  if (!workflowResult.success) {
    finalSuccess = false;
    finalError = workflowResult.error ?? "Workflow reported failure";
  }

  const generatedActionSteps = extractGeneratedActionSteps(actionScriptResult);
  if (finalSuccess && (!generatedActionSteps || generatedActionSteps.length === 0)) {
    finalSuccess = false;
    finalError = "Generation finished without executable action steps.";
  }

  const persistedTestScriptId = finalSuccess
    ? ensureGeneratedTestScript({
      projectId: projectId,
      testCase: testCase,
      projectUrl: project.url,
      testScriptId: actionScriptBuild.testScriptId,
      actionScriptId: actionScriptBuild.actionScriptId,
      actionScriptResult: actionScriptResult,
    })
    : actionScriptBuild.testScriptId;

  const runResult: ILocalRunResult = {
    id: runId,
    projectId: projectId,
    testScriptId: persistedTestScriptId,
    runType: LocalRunType.GENERATION,
    status: finalSuccess ? LocalRunStatus.PASSED : LocalRunStatus.FAILED,
    startedAt: startedAt,
    completedAt: completedAt,
    executionTimeMs: completedAt - startedAt,
    errorMessage: finalError,
    localScreenshots: [],
    actionScriptResult: actionScriptResult,
  };

  storageService.createRunResult(runResult);
  storageService.updateWorkflowRun({
    projectId: projectId,
    workflowRunId: actionScriptBuild.workflowRunId,
    updates: {
      status: finalSuccess ? LocalWorkflowRunStatus.COMPLETED : LocalWorkflowRunStatus.FAILED,
      finishedAt: completedAt,
      error: finalError,
    },
  });

  await cleanupTempFiles({
    filePaths: [inputFilePath, mutationFilePath, authFilePath, outputFilePath],
  });

  return runResult;
}

/**
 * Execute test script replay.
 * @param params - The parameters.
 * @param params.projectId - The project ID.
 * @param params.testScriptId - The test script ID.
 * @param params.timeoutMs - Optional timeout in milliseconds.
 * @returns The run result.
 */
export async function executeReplay (params: {
  projectId: string;
  testScriptId: string;
  timeoutMs?: number;
}): Promise<ILocalRunResult> {
  const { projectId, testScriptId, timeoutMs = DEFAULT_REPLAY_TIMEOUT_MS } = params;

  const storageService = getProjectStorageService();

  const testScript = storageService.getTestScript({
    projectId: projectId,
    testScriptId: testScriptId,
  });
  if (!testScript) {
    throw new Error(`Test script not found: ${testScriptId}`);
  }

  const project = storageService.getProject(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const useCase = storageService.getUseCase({
    projectId: projectId,
    useCaseId: testScript.useCaseId,
  });
  if (!useCase) {
    throw new Error(`Use case not found: ${testScript.useCaseId}`);
  }

  const testCase = storageService.getTestCase({
    projectId: projectId,
    testCaseId: testScript.testCaseId,
  });
  if (!testCase) {
    throw new Error(`Test case not found: ${testScript.testCaseId}`);
  }

  const userId = getAuthenticatedUserId();
  const authContent = buildStudioAuthContent();

  const localSecretOptions = buildSecretOptionsFromLocalSecrets({
    localSecrets: storageService.listSecrets(projectId),
  });
  const localWorkflowFiles = storageService.resolveWorkflowFilesForExecution({
    projectId: projectId,
    useCaseId: testScript.useCaseId,
    testCaseId: testScript.testCaseId,
  });
  const workflowFileMetadata = mapWorkflowFilesToMetadata(localWorkflowFiles);

  const runId = generateRunId();
  const actionScriptBuild = buildReplayActionScript({
    projectSecretOptions: localSecretOptions,
    projectWorkflowFiles: workflowFileMetadata,
    testScript: testScript,
    userId: userId,
  });
  const localWorkflowRun = buildLocalWorkflowRun({
    projectId: projectId,
    workflowRunId: actionScriptBuild.workflowRunId,
    ownerId: userId,
    taskDef: actionScriptBuild.actionParams,
  });
  storageService.createWorkflowRun(localWorkflowRun);

  const inputFilePath = await writeTempFile({
    filename: `${runId}_input.json`,
    data: actionScriptBuild.actionScript,
  });
  const mutationFilePath = await writeTempFile({
    filename: `${runId}_mutations.json`,
    data: [],
  });
  const authFilePath = await writeTempFile({
    filename: `${runId}_auth.json`,
    data: authContent,
  });

  const outputFilePath = path.join(await ensureTempDir(), `${runId}_output.json`);

  const executionProcess = await spawnElectronApp({
    runId: runId,
    projectId: projectId,
    entityId: testScriptId,
    runType: LocalRunType.REPLAY,
    runMode: "engine",
    inputFilePath: inputFilePath,
    mutationFilePath: mutationFilePath,
    outputFilePath: outputFilePath,
    authFilePath: authFilePath,
    timeoutMs: timeoutMs,
  });

  const startedAt = executionProcess.startedAt;

  const result = await waitForCompletion({ executionProcess: executionProcess });

  const completedAt = Date.now();

  const workflowResult = await checkWorkflowRunResult({
    projectId: projectId,
    workflowRunId: actionScriptBuild.workflowRunId,
  });

  let finalSuccess = result.success && workflowResult.success;
  let finalError = result.error ?? workflowResult.error;

  if (!workflowResult.success) {
    finalSuccess = false;
    finalError = workflowResult.error ?? "Workflow reported failure";
  }

  const runResult: ILocalRunResult = {
    id: runId,
    projectId: projectId,
    testScriptId: testScriptId,
    runType: LocalRunType.REPLAY,
    status: finalSuccess ? LocalRunStatus.PASSED : LocalRunStatus.FAILED,
    startedAt: startedAt,
    completedAt: completedAt,
    executionTimeMs: completedAt - startedAt,
    errorMessage: finalError,
    localScreenshots: [],
    actionScriptResult: result.actionScript,
  };

  storageService.createRunResult(runResult);
  storageService.updateWorkflowRun({
    projectId: projectId,
    workflowRunId: actionScriptBuild.workflowRunId,
    updates: {
      status: finalSuccess ? LocalWorkflowRunStatus.COMPLETED : LocalWorkflowRunStatus.FAILED,
      finishedAt: completedAt,
      error: finalError,
    },
  });

  await cleanupTempFiles({
    filePaths: [inputFilePath, mutationFilePath, authFilePath, outputFilePath],
  });

  return runResult;
}

/**
 * Cancel an active execution.
 * @param params - The parameters.
 * @param params.runId - The run ID to cancel.
 * @returns Whether the cancellation was successful.
 */
export function cancelExecution (params: { runId: string; }): boolean {
  const { runId } = params;

  const executionProcess = activeProcesses.get(runId);
  if (!executionProcess) {
    return false;
  }

  if (executionProcess.status !== LocalRunStatus.RUNNING) {
    return false;
  }

  executionProcess.status = LocalRunStatus.CANCELLED;

  if (executionProcess.timeoutTimer) {
    clearTimeout(executionProcess.timeoutTimer);
  }

  try {
    executionProcess.process.kill("SIGTERM");
  } catch {
    /* ignore kill errors */
  }

  return true;
}

/**
 * List active executions.
 * @returns Array of active execution info.
 */
export function listActiveExecutions (): Array<{
  runId: string;
  projectId: string;
  entityId: string;
  runType: LocalRunType;
  pid: number;
  startedAt: number;
  status: LocalRunStatus;
}> {
  return Array.from(activeProcesses.values()).map((proc) => ({
    runId: proc.runId,
    projectId: proc.projectId,
    entityId: proc.entityId,
    runType: proc.runType,
    pid: proc.pid,
    startedAt: proc.startedAt,
    status: proc.status,
  }));
}
