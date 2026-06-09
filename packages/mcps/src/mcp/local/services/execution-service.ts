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
import { fileURLToPath } from "node:url";
import * as path from "path";

import {
  getConfig,
  getElectronAppDir,
  getElectronAppVersion,
  resolveElectronAppPathOrNull,
} from "../../../shared/config.js";
import { getLogger } from "../../../shared/logger.js";
import type { TestCaseDetails, TestScriptDetails } from "../contracts/project-schemas.js";
import { getAuthService, getRunResultStorageService, getStorageService } from "./index.js";
import {
  buildGenerationActionScript,
  buildReplayActionScript,
} from "./action-script-builders.js";
import { acquireLocalExecutionLock } from "./local-execution-lock.js";
import type { ILocalExecutionContext } from "./run-result-storage-service.js";
import type { RunResultStatus } from "./run-result-storage-service.js";

const logger = getLogger();


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
  /** Electron's spawn cwd (path.dirname of the electron binary). Needed to locate user_data/runtime/ for artifact preservation. */
  electronCwd: string;
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

/**
 * Cloud identifiers the studio attaches to its result after publishing the run.
 */
interface IStudioCloudRefs {
  /** Dashboard URL for the published run. */
  viewUrl?: string;
  /** Cloud test script ID (absent for a failed generation). */
  cloudTestScriptId?: string;
  /** Cloud action script ID. */
  cloudActionScriptId?: string;
}

/**
 * Pull the studio-published cloud identifiers off the studio's result object.
 *
 * The studio publishes the run during execution and carries `viewUrl` /
 * `testScriptId` / `actionScriptId` back on its result. That object is `unknown`
 * here, so narrow each field independently and drop anything that isn't a
 * non-empty string. Returns only the fields that are actually present.
 */
function extractStudioCloudRefs(studioReturnedResult: unknown): IStudioCloudRefs {
  if (typeof studioReturnedResult !== "object" || studioReturnedResult === null) {
    return {};
  }
  const source = studioReturnedResult as Record<string, unknown>;
  const asString = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() !== "" ? value : undefined;

  const refs: IStudioCloudRefs = {};
  const viewUrl = asString(source.viewUrl);
  const cloudTestScriptId = asString(source.testScriptId);
  const cloudActionScriptId = asString(source.actionScriptId);
  if (viewUrl !== undefined) refs.viewUrl = viewUrl;
  if (cloudTestScriptId !== undefined) refs.cloudTestScriptId = cloudTestScriptId;
  if (cloudActionScriptId !== undefined) refs.cloudActionScriptId = cloudActionScriptId;
  return refs;
}

/**
 * Read the studio's `gen_<input>.json` result file written next to the input
 * script. Returns undefined when no result file exists (e.g. an older studio
 * build that doesn't emit one) — callers narrow defensively.
 */
async function readStudioResultFile(inputFilePath: string): Promise<unknown> {
  const resultPath = path.join(
    path.dirname(inputFilePath),
    `gen_${path.basename(inputFilePath)}`,
  );
  try {
    return JSON.parse(await fs.readFile(resultPath, "utf-8"));
  } catch {
    return undefined;
  }
}

/** Map of active execution processes. */
const activeProcesses: Map<string, IInternalExecutionProcess> = new Map();

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
  const currentDir = path.dirname(fileURLToPath(currentFileUrl));

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
 * Preserve Electron runtime artifacts (per-step screenshots, action scripts)
 * to the session artifacts dir so failed runs are debuggable.
 *
 * Strategy:
 * 1. Read marker file at `<tempDir>/<runId>_runtime_dir.txt` (Electron writes
 *    this on startup with the absolute runtime dir path) — reliable correlation.
 * 2. Fallback: scan `<electronCwd>/user_data/runtime/` for the directory whose
 *    mtime is closest to (and after) `spawnAtMs` — best-effort for older
 *    Electron builds that don't yet write the marker.
 * 3. Copy that dir to `<sessionsDir>/<runId>/electron-runtime/`.
 *
 * Best-effort — never throws. Failed preservation logs a warning and returns.
 */
async function preserveElectronRuntimeArtifacts(params: {
  runId: string;
  electronCwd: string;
  spawnAtMs: number;
}): Promise<void> {
  try {
    const tempDir = await ensureTempDir();
    const markerPath = path.join(tempDir, `${params.runId}_runtime_dir.txt`);

    let runtimeDir: string | null = null;
    try {
      const marker = await fs.readFile(markerPath, "utf-8");
      const trimmed = marker.trim();
      if (trimmed.length > 0) runtimeDir = trimmed;
    } catch (markerReadError) {
      if ((markerReadError as NodeJS.ErrnoException).code !== "ENOENT") {
        logger.warn("Failed to read runtime-dir marker", {
          runId: params.runId,
          error: String(markerReadError),
        });
      }
    }

    if (runtimeDir === null) {
      runtimeDir = await scanForRuntimeDirByMtime({
        electronCwd: params.electronCwd,
        spawnAtMs: params.spawnAtMs,
      });
    }

    if (runtimeDir === null) {
      logger.info("No Electron runtime dir found to preserve", { runId: params.runId });
      return;
    }

    try {
      await fs.access(runtimeDir);
    } catch {
      logger.warn("Electron runtime dir referenced but missing on disk", {
        runId: params.runId,
        runtimeDir: runtimeDir,
      });
      await fs.unlink(markerPath).catch(() => undefined);
      return;
    }

    const storage = getStorageService();
    const destDir = path.join(storage.getSessionsDir(), params.runId, "electron-runtime");
    await fs.mkdir(destDir, { recursive: true });
    await fs.cp(runtimeDir, destDir, { recursive: true });

    logger.info("Preserved Electron runtime artifacts", {
      runId: params.runId,
      sourceDir: runtimeDir,
      destDir: destDir,
    });

    await fs.unlink(markerPath).catch(() => undefined);
  } catch (preserveError) {
    logger.warn("Failed to preserve Electron runtime artifacts", {
      runId: params.runId,
      error: preserveError instanceof Error ? preserveError.message : String(preserveError),
    });
  }
}

/**
 * Scan Electron's `user_data/runtime/` for the runtime dir most likely matching
 * the current run, identified as the subdir whose mtime is at-or-after `spawnAtMs`
 * with the latest mtime. Returns null if the runtime root doesn't exist or no
 * candidate is found.
 */
async function scanForRuntimeDirByMtime(params: {
  electronCwd: string;
  spawnAtMs: number;
}): Promise<string | null> {
  const runtimeRoot = path.join(params.electronCwd, "user_data", "runtime");
  try {
    const entries = await fs.readdir(runtimeRoot, { withFileTypes: true });
    let bestCandidate: { path: string; mtimeMs: number } | null = null;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(runtimeRoot, entry.name);
      const stat = await fs.stat(fullPath);
      if (stat.mtimeMs < params.spawnAtMs) continue;
      if (bestCandidate === null || stat.mtimeMs > bestCandidate.mtimeMs) {
        bestCandidate = { path: fullPath, mtimeMs: stat.mtimeMs };
      }
    }
    return bestCandidate?.path ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the electron-app binary path on every call.
 *
 * Re-resolves from the filesystem each invocation so a long-running MCP
 * server picks up `muggle upgrade` / `muggle setup` changes without a
 * process restart.
 *
 * Throws a detailed error if the binary cannot be found.
 */
function getElectronAppPathOrThrow(): string {
  const electronAppPath = resolveElectronAppPathOrNull();
  if (electronAppPath && electronAppPath.trim() !== "") {
    return electronAppPath;
  }

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

/**
 * Spawn electron-app in the requested mode and wait for completion.
 */
async function executeElectronAppAsync(params: {
  runId: string;
  runType: "generation" | "replay";
  scriptFilePath: string;
  authFilePath: string;
  mutationsFilePath?: string;
  timeoutMs: number;
  showUi?: boolean;
  freshSession?: boolean;
}): Promise<IElectronExecutionResult> {
  const mode = params.runType === "generation" ? "explore" : "engine";
  const electronAppPath = getElectronAppPathOrThrow();
  const spawnArgs = [mode, params.scriptFilePath, params.mutationsFilePath ?? "", params.authFilePath];

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

  const electronCwd = path.dirname(electronAppPath);
  const child = spawn(electronAppPath, spawnArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    env: electronEnv,
    cwd: electronCwd,
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
          electronCwd: electronCwd,
        },
      });
    });
  });
}

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
  cwd: string;
  mutations?: string[];
  timeoutMs?: number;
  showUi?: boolean;
  freshSession?: boolean;
}): Promise<ILocalRunResult> {
  const lockHandle = await acquireLocalExecutionLock({ cwd: params.cwd });
  try {
    return await runTestGenerationLocked(params);
  } finally {
    await lockHandle.release();
  }
}

async function runTestGenerationLocked(params: {
  testCase: TestCaseDetails;
  localUrl: string;
  mutations?: string[];
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
    const mutationsFilePath =
      params.mutations && params.mutations.length > 0
        ? await writeTempFile({
            filename: `${runId}_mutations.json`,
            data: params.mutations,
          })
        : undefined;

    try {
      const executionResult = await executeElectronAppAsync({
        runId: runId,
        runType: "generation",
        scriptFilePath: inputFilePath,
        mutationsFilePath: mutationsFilePath,
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

      // Preserve Electron per-step screenshots regardless of outcome — failed
      // runs are where these matter most, but success runs also benefit so the
      // dashboard can show the step-by-step playback.
      await preserveElectronRuntimeArtifacts({
        runId: runId,
        electronCwd: executionResult.electronCwd,
        spawnAtMs: startedAt,
      });

      if (executionResult.exitCode !== 0) {
        const failureMessage =
          `Electron exited with code ${executionResult.exitCode}.\n` +
          `STDOUT:\n${executionResult.stdout}\n` +
          `STDERR:\n${executionResult.stderr}`;

        const sessionsDir = getStorageService().getSessionsDir();
        const artifactsDir = path.join(sessionsDir, runId);
        const generatedScriptPath = path.join(
          path.dirname(inputFilePath),
          `gen_${path.basename(inputFilePath)}`,
        );
        // goal_not_achievable and partial-progress failures often still leave a gen_*.json
        // with the agent's attempted steps + halt summary. Persist it so reviewers can see
        // what was tried, and read the studio's cloud refs off it — the backend still
        // records the action script + viewUrl for a failed generation (no test script).
        // Silent on missing — early Electron crashes write no gen file.
        let failedStudioResult: unknown;
        try {
          const failedScriptRaw = await fs.readFile(generatedScriptPath, "utf-8");
          failedStudioResult = JSON.parse(failedScriptRaw);
          await fs.copyFile(generatedScriptPath, path.join(artifactsDir, "action-script.json"));
          await fs.unlink(generatedScriptPath).catch(() => {});
        } catch {
          // No gen file produced before failure.
        }

        const failedStudioCloudRefs = extractStudioCloudRefs(failedStudioResult);
        storage.updateRunResult(runId, {
          status: "failed",
          testScriptId: localTestScript.id,
          executionTimeMs: executionTimeMs,
          errorMessage: failureMessage,
          artifactsDir: artifactsDir,
          studioReturnedResult: failedStudioResult,
          ...failedStudioCloudRefs,
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
      const studioCloudRefs = extractStudioCloudRefs(generatedScript);
      storage.updateRunResult(runId, {
        status: "passed",
        testScriptId: localTestScript.id,
        executionTimeMs: executionTimeMs,
        artifactsDir: artifactsDir,
        studioReturnedResult: generatedScript,
        ...studioCloudRefs,
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
  cwd: string;
  mutations?: string[];
  timeoutMs?: number;
  showUi?: boolean;
  freshSession?: boolean;
}): Promise<ILocalRunResult> {
  const lockHandle = await acquireLocalExecutionLock({ cwd: params.cwd });
  try {
    return await runReplayLocked(params);
  } finally {
    await lockHandle.release();
  }
}

async function runReplayLocked(params: {
  testScript: TestScriptDetails;
  actionScript: unknown[];
  localUrl: string;
  mutations?: string[];
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
    const mutationsFilePath =
      params.mutations && params.mutations.length > 0
        ? await writeTempFile({
            filename: `${runId}_mutations.json`,
            data: params.mutations,
          })
        : undefined;

    try {
      const executionResult = await executeElectronAppAsync({
        runId: runId,
        runType: "replay",
        scriptFilePath: inputFilePath,
        mutationsFilePath: mutationsFilePath,
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

      // Preserve Electron per-step screenshots regardless of outcome — failed
      // replays are where these matter most for diagnosing what the agent saw.
      await preserveElectronRuntimeArtifacts({
        runId: runId,
        electronCwd: executionResult.electronCwd,
        spawnAtMs: startedAt,
      });

      if (executionResult.exitCode !== 0) {
        const failureMessage =
          `Electron exited with code ${executionResult.exitCode}.\n` +
          `STDOUT:\n${executionResult.stdout}\n` +
          `STDERR:\n${executionResult.stderr}`;
        const artifactsDir = path.join(getStorageService().getSessionsDir(), runId);
        storage.updateRunResult(runId, {
          status: "failed",
          executionTimeMs: executionTimeMs,
          errorMessage: failureMessage,
          artifactsDir: artifactsDir,
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
      const replayStudioResult = await readStudioResultFile(inputFilePath);
      const replayStudioCloudRefs = extractStudioCloudRefs(replayStudioResult);
      storage.updateRunResult(runId, {
        status: "passed",
        executionTimeMs: executionTimeMs,
        artifactsDir: artifactsDir,
        studioReturnedResult: replayStudioResult,
        ...replayStudioCloudRefs,
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
