/**
 * Tool registry for local E2E execution (historical path: local-qa).
 * Manages the minimal set of local execution tools.
 *
 * All entity management (projects, use cases, test cases, secrets) happens via muggle-remote-* cloud tools.
 * Local tools only handle: status, execution, results, and publishing.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getPromptServiceClient } from "../../e2e/upstream-client.js";
import { RunEnvironment } from "../../e2e/contracts/run-environment.js";
import { getCallerCredentialsAsync } from "../../../shared/auth.js";
import { getLogger } from "../../../shared/logger.js";
import { EventName, Outcome, ToolSurface, track } from "@muggleai/telemetry";
import type { IMcpToolResult, ILocalMcpTool } from "../../local/types/index.js";
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
  PreferencesSetInputSchema,
  LastProjectGetInputSchema,
  LastProjectSetInputSchema,
  LastProjectClearInputSchema,
  LastHostGetInputSchema,
  LastHostSetInputSchema,
  LastHostClearInputSchema,
  SkillTelemetryEmitInputSchema,
  EventTelemetryEmitInputSchema,
} from "../../local/contracts/index.js";
import { appendFailureEvent } from "../../../shared/failure-events.js";
import { writePreferences } from "../../../shared/preferences.js";
import {
  readLastProject,
  writeLastProject,
  clearLastProject,
  LAST_PROJECT_FILE_NAME,
} from "../../../shared/last-project.js";
import {
  readLastHost,
  writeLastHost,
  clearLastHost,
  LAST_HOST_FILE_NAME,
} from "../../../shared/last-host.js";
import {
  cancelExecution,
  executeReplay,
  executeTestGeneration,
  getAuthService,
  getStorageService,
  getRunResultStorageService,
} from "../../local/services/index.js";

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


const checkStatusTool: ILocalMcpTool = {
  name: "muggle-local-check-status",
  description: "Check the status of Muggle Test Local. This verifies the connection to web-service and shows current session information.",
  inputSchema: EmptyInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-check-status");

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
  name: "muggle-local-list-sessions",
  description: "List all stored testing sessions. Shows session IDs, status, and metadata for each session.",
  inputSchema: ListSessionsInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-list-sessions");

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


const runResultListTool: ILocalMcpTool = {
  name: "muggle-local-run-result-list",
  description: "List run results (test generation and replay history), optionally filtered by cloud test case ID.",
  inputSchema: RunResultListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-run-result-list");

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
  name: "muggle-local-run-result-get",
  description: "Get detailed information about a run result including screenshots and action script output.",
  inputSchema: RunResultGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-run-result-get");

    const input = RunResultGetInputSchema.parse(ctx.input);
    const storage = getRunResultStorageService();
    const result = storage.getRunResult(input.runId);

    if (!result) {
      return { content: `Run result not found: ${input.runId}`, isError: true };
    }

    const contentParts = [
      "## Run Result Details",
      "",
      `**ID:** ${result.id}`,
      `**Type:** ${result.runType}`,
      `**Status:** ${result.status}`,
      `**Cloud Test Case:** ${result.cloudTestCaseId}`,
      `**Duration:** ${result.executionTimeMs ?? 0}ms`,
      result.errorMessage ? `**Error:** ${result.errorMessage}` : "",
    ];

    let testScriptSteps: number | undefined;
    if (result.testScriptId) {
      const testScript = storage.getTestScript(result.testScriptId);
      testScriptSteps = testScript?.actionScript?.length;
    }

    if (result.artifactsDir && fs.existsSync(result.artifactsDir)) {
      contentParts.push(
        "",
        "### Artifacts (view action script + screenshots)",
        "",
        `**Location:** \`${result.artifactsDir}\``,
        "",
      );

      const actionScriptPath = path.join(result.artifactsDir, "action-script.json");
      const resultsMdPath = path.join(result.artifactsDir, "results.md");
      const screenshotsDir = path.join(result.artifactsDir, "screenshots");
      const stdoutLogPath = path.join(result.artifactsDir, "stdout.log");
      const stderrLogPath = path.join(result.artifactsDir, "stderr.log");

      const artifactItems: string[] = [];
      if (fs.existsSync(actionScriptPath)) {
        artifactItems.push("- `action-script.json` — generated test steps");
      }
      if (fs.existsSync(resultsMdPath)) {
        artifactItems.push("- `results.md` — step-by-step report with screenshot links");
      }
      if (fs.existsSync(screenshotsDir)) {
        const screenshots = fs.readdirSync(screenshotsDir).filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f));
        artifactItems.push(`- \`screenshots/\` — ${screenshots.length} image(s)`);
      }
      if (fs.existsSync(stdoutLogPath)) {
        artifactItems.push("- `stdout.log` — electron-app stdout output");
      }
      if (fs.existsSync(stderrLogPath)) {
        artifactItems.push("- `stderr.log` — electron-app stderr output");
      }
      if (artifactItems.length > 0) {
        contentParts.push(artifactItems.join("\n"), "");
      }
    }

    contentParts.push(
      "",
      "### Ending state",
      "",
      `- **Status:** ${result.status}`,
      `- **Duration:** ${result.executionTimeMs ?? 0}ms`,
      testScriptSteps !== undefined ? `- **Steps generated:** ${testScriptSteps}` : "",
      result.artifactsDir ? `- **Artifacts path:** \`${result.artifactsDir}\`` : "",
    );

    const content = contentParts.filter(Boolean).join("\n");

    return { content: content, isError: false, data: result };
  },
};


const testScriptListTool: ILocalMcpTool = {
  name: "muggle-local-test-script-list",
  description: "List locally generated test scripts, optionally filtered by cloud test case ID.",
  inputSchema: TestScriptListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-test-script-list");

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
  name: "muggle-local-test-script-get",
  description: "Get details of a locally generated test script including action script steps.",
  inputSchema: TestScriptGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-test-script-get");

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


const executeTestGenerationTool: ILocalMcpTool = {
  name: "muggle-local-execute-test-generation",
  description: "Generate an end-to-end (E2E) acceptance test script by launching a real browser against your web app. The browser navigates your app, executes the test case steps (like signing up, filling forms, clicking through flows), and produces a replayable test script with screenshots. Use this to create new browser tests for any user flow. Requires a test case (from muggle-remote-test-case-get) and a localhost URL. Launches an Electron browser — defaults to a visible window; pass showUi: false to run headless.",
  inputSchema: ExecuteTestGenerationInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-execute-test-generation");

    const input = ExecuteTestGenerationInputSchema.parse(ctx.input);

    const showUi = input.showUi !== false;

    try {
      const result = await executeTestGeneration({
        testCase: input.testCase,
        localUrl: input.localUrl,
        cwd: input.cwd,
        mutations: input.mutations,
        timeoutMs: input.timeoutMs,
        showUi: showUi,
        freshSession: input.freshSession,
      });

      const content = [
        "## Test Generation " + (result.status === "passed" ? "Successful" : "Failed"),
        "",
        `**Run ID:** ${result.id}`,
        `**Test Script ID:** ${result.testScriptId}`,
        `**Status:** ${result.status}`,
        `**Duration:** ${result.executionTimeMs}ms`,
        `**UI:** ${showUi ? "visible GUI" : "headless"}`,
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
  name: "muggle-local-execute-replay",
  description: "Replay an existing E2E acceptance test script in a real browser to verify your app still works correctly — use this for regression testing after code changes. The browser executes each saved step and captures screenshots so you can see what happened. Requires: (1) test script metadata from muggle-remote-test-script-get, (2) actionScript content from muggle-remote-action-script-get using the testScript.actionScriptId, and (3) a localhost URL. Launches an Electron browser — defaults to a visible window; pass showUi: false to run headless.",
  inputSchema: ExecuteReplayInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-execute-replay");

    const input = ExecuteReplayInputSchema.parse(ctx.input);

    const showUi = input.showUi !== false;

    try {
      const result = await executeReplay({
        testScript: input.testScript,
        actionScript: input.actionScript,
        localUrl: input.localUrl,
        cwd: input.cwd,
        mutations: input.mutations,
        timeoutMs: input.timeoutMs,
        showUi: showUi,
        freshSession: input.freshSession,
      });

      const content = [
        "## Test Replay " + (result.status === "passed" ? "Successful" : "Failed"),
        "",
        `**Run ID:** ${result.id}`,
        `**Test Script ID:** ${result.testScriptId}`,
        `**Status:** ${result.status}`,
        `**Duration:** ${result.executionTimeMs}ms`,
        `**UI:** ${showUi ? "visible GUI" : "headless"}`,
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
  name: "muggle-local-cancel-execution",
  description: "Cancel an active test generation or replay execution.",
  inputSchema: CancelExecutionInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-cancel-execution");

    const input = CancelExecutionInputSchema.parse(ctx.input);

    const cancelled = cancelExecution({ runId: input.runId });

    if (cancelled) {
      return { content: `Execution cancelled: ${input.runId}`, isError: false };
    }

    return { content: `No active execution found with ID: ${input.runId}`, isError: true };
  },
};


const publishTestScriptTool: ILocalMcpTool = {
  name: "muggle-local-publish-test-script",
  description: "Publish a locally generated test script to the cloud. Uses the run ID from muggle_execute_test_generation to find the script and uploads it to the specified cloud test case. Returns a viewUrl that can be opened in the user's browser to view the published test script on the dashboard.",
  inputSchema: PublishTestScriptInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-publish-test-script");

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

    if (runResult.runType !== "generation") {
      return {
        content: `Only generation runs can be published. Run ${input.runId} is '${runResult.runType}'.`,
        isError: true,
      };
    }
    if (runResult.status !== "passed" && runResult.status !== "failed") {
      return {
        content: `Run ${input.runId} must be in passed/failed state before publishing. Current status: ${runResult.status}.`,
        isError: true,
      };
    }
    if (!Array.isArray(testScript.actionScript) || testScript.actionScript.length === 0) {
      return {
        content: `Test script ${testScript.id} has no generated actionScript steps to publish.`,
        isError: true,
      };
    }
    if (!runResult.projectId) {
      return { content: `Run result ${input.runId} is missing projectId.`, isError: true };
    }
    if (!runResult.useCaseId) {
      return { content: `Run result ${input.runId} is missing useCaseId.`, isError: true };
    }
    if (!runResult.productionUrl) {
      return { content: `Run result ${input.runId} is missing productionUrl.`, isError: true };
    }
    if (!runResult.executionTimeMs && runResult.executionTimeMs !== 0) {
      return { content: `Run result ${input.runId} is missing executionTimeMs.`, isError: true };
    }
    if (!runResult.localExecutionContext) {
      return { content: `Run result ${input.runId} is missing localExecutionContext.`, isError: true };
    }
    if (!runResult.localExecutionContext.localExecutionCompletedAt) {
      return {
        content: `Run result ${input.runId} is missing localExecutionCompletedAt in localExecutionContext.`,
        isError: true,
      };
    }

    const authStatus = getAuthService().getAuthStatus();
    if (!authStatus.userId) {
      return { content: "Authenticated user ID is missing. Please login again.", isError: true };
    }

    try {
      const credentials = await getCallerCredentialsAsync();
      const client = getPromptServiceClient();
      const uploadedAt = Date.now();

      const response = await client.execute<{
        workflowRuntimeId: string;
        workflowRunId: string;
        testScriptId: string;
        actionScriptId: string;
        viewUrl: string;
      }>(
        {
          method: "POST",
          path: "/v1/protected/muggle-test/local-run/upload",
          body: {
            projectId: runResult.projectId,
            useCaseId: runResult.useCaseId,
            testCaseId: input.cloudTestCaseId,
            runType: runResult.runType,
            // A published run always originates from local Electron execution, so it
            // belongs to the local lane — the cloud must resolve the developer's
            // localhost credentials, not the remote managed-profile pool.
            type: RunEnvironment.Local,
            productionUrl: runResult.productionUrl,
            localExecutionContext: {
              originalUrl: runResult.localExecutionContext.originalUrl,
              productionUrl: runResult.localExecutionContext.productionUrl,
              runByUserId: authStatus.userId,
              machineHostname: runResult.localExecutionContext.machineHostname,
              osInfo: runResult.localExecutionContext.osInfo,
              electronAppVersion: runResult.localExecutionContext.electronAppVersion,
              mcpServerVersion: runResult.localExecutionContext.mcpServerVersion,
              localExecutionCompletedAt: runResult.localExecutionContext.localExecutionCompletedAt,
              uploadedAt: uploadedAt,
            },
            actionScript: testScript.actionScript,
            summaryStep: testScript.summaryStep,
            status: runResult.status === "passed" ? "passed" : "failed",
            executionTimeMs: runResult.executionTimeMs,
            errorMessage: runResult.errorMessage,
          },
        },
        credentials,
        ctx.correlationId,
      );

      storage.updateTestScript(testScript.id, {
        status: "published",
        cloudActionScriptId: response.data.actionScriptId,
      });

      storage.updateRunResult(runResult.id, {
        localExecutionContext: {
          ...runResult.localExecutionContext,
          runByUserId: authStatus.userId,
        },
      });

      return {
        content: [
          "## Test Script Published",
          "",
          `**Run ID:** ${input.runId}`,
          `**Local Test Script ID:** ${testScript.id}`,
          `**Cloud Test Case ID:** ${input.cloudTestCaseId}`,
          `**Cloud Test Script ID:** ${response.data.testScriptId}`,
          `**Cloud Action Script ID:** ${response.data.actionScriptId}`,
          `**Workflow Runtime ID:** ${response.data.workflowRuntimeId}`,
          `**Workflow Run ID:** ${response.data.workflowRunId}`,
          `**View URL:** ${response.data.viewUrl}`,
        ].join("\n"),
        isError: false,
        data: response.data,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to publish local test script to cloud", {
        runId: input.runId,
        cloudTestCaseId: input.cloudTestCaseId,
        error: errorMessage,
      });
      return {
        content: `Failed to publish test script: ${errorMessage}`,
        isError: true,
      };
    }
  },
};


const preferencesSetTool: ILocalMcpTool = {
  name: "muggle-local-preferences-set",
  description:
    "Set a Muggle AI user preference. Preferences control automation behavior (auto-login, show browser, suggest test cases, etc.). " +
    "Values: 'always' (proceed without asking), 'ask' (prompt each time), 'never' (skip without asking). " +
    "Scope: 'global' writes to ~/.muggle-ai/preferences.json, 'project' writes to .muggle-ai/preferences.json in the repo root.",
  inputSchema: PreferencesSetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-preferences-set");

    const input = PreferencesSetInputSchema.parse(ctx.input);

    writePreferences(
      { [input.key]: input.value },
      input.scope,
      undefined,
      input.cwd,
    );

    return {
      content: `**${input.key}** set to **${input.value}** (${input.scope}).`,
      isError: false,
    };
  },
};


const lastProjectGetTool: ILocalMcpTool = {
  name: "muggle-local-last-project-get",
  description:
    "Get the cached last-used Muggle Test project for a repo (read from <cwd>/.muggle-ai/last-project.json). " +
    "Returns the project ID, URL, name, and saved-at timestamp, or null if no cache exists. " +
    "Skills consult this when 'autoSelectProject = always' to silently reuse the project the user picked previously, instead of presenting the project picker every time.",
  inputSchema: LastProjectGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-last-project-get");

    const input = LastProjectGetInputSchema.parse(ctx.input);
    const cached = readLastProject(input.cwd);

    if (!cached) {
      const content = [
        "No cached last-used project for this repo.",
        "",
        `Looked at: \`${input.cwd}/.muggle-ai/${LAST_PROJECT_FILE_NAME}\``,
        "",
        "The cache is populated when a user picks an existing project AND chooses 'Yes, save it' on the memory picker (the autoSelectProject preference).",
      ].join("\n");
      return { content: content, isError: false };
    }

    const content = [
      "**Cached last-used project:**",
      "",
      `- ID: \`${cached.projectId}\``,
      `- URL: ${cached.projectUrl}`,
      `- Name: ${cached.projectName}`,
      `- Saved at: ${cached.savedAt}`,
    ].join("\n");
    return { content: content, isError: false };
  },
};

const lastProjectSetTool: ILocalMcpTool = {
  name: "muggle-local-last-project-set",
  description:
    "Save the user's selected Muggle Test project as the cached last-used project for this repo. " +
    "Writes to <cwd>/.muggle-ai/last-project.json. Subsequent skill invocations honor 'autoSelectProject = always' " +
    "by silently reusing this entry — no project picker shown. Always pair this call with " +
    "'muggle-local-preferences-set autoSelectProject=always' when the user chose 'Yes, save it'.",
  inputSchema: LastProjectSetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-last-project-set");

    const input = LastProjectSetInputSchema.parse(ctx.input);
    writeLastProject(input.cwd, {
      projectId: input.projectId,
      projectUrl: input.projectUrl,
      projectName: input.projectName,
    });

    const content = [
      `Cached **${input.projectName}** as the last-used project for this repo.`,
      "",
      `Written to: \`${input.cwd}/.muggle-ai/${LAST_PROJECT_FILE_NAME}\``,
      "",
      "Skills will silently reuse this project on future runs when `autoSelectProject = always`.",
    ].join("\n");
    return { content: content, isError: false };
  },
};

const lastProjectClearTool: ILocalMcpTool = {
  name: "muggle-local-last-project-clear",
  description:
    "Remove the cached last-used project for this repo. After this, `autoSelectProject = always` will fall through to ask " +
    "until the user picks a new project. No-op if no cache exists.",
  inputSchema: LastProjectClearInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-last-project-clear");

    const input = LastProjectClearInputSchema.parse(ctx.input);
    clearLastProject(input.cwd);

    const content = [
      "Cleared the cached last-used project for this repo.",
      "",
      `Path: \`${input.cwd}/.muggle-ai/${LAST_PROJECT_FILE_NAME}\``,
    ].join("\n");
    return { content: content, isError: false };
  },
};


const lastHostGetTool: ILocalMcpTool = {
  name: "muggle-local-last-host-get",
  description:
    "Get the cached last-used local dev server URL for a repo (read from <cwd>/.muggle-ai/last-host.json). " +
    "Returns the URL and saved-at timestamp, or null if no cache exists. " +
    "Skills consult this when 'autoSelectLocalHost = always' to silently reuse the URL the user used previously.",
  inputSchema: LastHostGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-last-host-get");

    const input = LastHostGetInputSchema.parse(ctx.input);
    const cached = readLastHost(input.cwd);

    if (!cached) {
      const content = [
        "No cached last-used host for this repo.",
        "",
        `Looked at: \`${input.cwd}/.muggle-ai/${LAST_HOST_FILE_NAME}\``,
      ].join("\n");
      return { content: content, isError: false };
    }

    const content = [
      "**Cached last-used host:**",
      "",
      `- URL: ${cached.host}`,
      `- Saved at: ${cached.savedAt}`,
    ].join("\n");
    return { content: content, isError: false };
  },
};

const lastHostSetTool: ILocalMcpTool = {
  name: "muggle-local-last-host-set",
  description:
    "Save the user's chosen local dev server URL as the cached last-used host for this repo. " +
    "Writes to <cwd>/.muggle-ai/last-host.json. Call this on every host pick (independent of 'Remember this URL?' Picker 2) " +
    "so future runs can offer 'Use {lastHost}' regardless of whether the user opted to set autoSelectLocalHost=always.",
  inputSchema: LastHostSetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-last-host-set");

    const input = LastHostSetInputSchema.parse(ctx.input);
    writeLastHost(input.cwd, input.host);

    return {
      content: `Cached **${input.host}** as the last-used host for this repo.`,
      isError: false,
    };
  },
};

const lastHostClearTool: ILocalMcpTool = {
  name: "muggle-local-last-host-clear",
  description:
    "Remove the cached last-used host for this repo. After this, `autoSelectLocalHost = always` will fall through to ask " +
    "until the user picks a new URL. No-op if no cache exists.",
  inputSchema: LastHostClearInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle-local-last-host-clear");

    const input = LastHostClearInputSchema.parse(ctx.input);
    clearLastHost(input.cwd);

    return {
      content: `Cleared the cached last-used host for this repo.`,
      isError: false,
    };
  },
};


// Skills call this in their first step so we can count skill invocations.
// Always returns ok — never blocks the skill on telemetry failure.
const telemetrySkillEmitTool: ILocalMcpTool = {
  name: "muggle-local-telemetry-skill-emit",
  description:
    "Emit a client telemetry event recording that a Muggle Test skill was invoked. Each muggle-* skill " +
    "calls this in its first step so we can measure skill usage. Never fails the skill on telemetry errors.",
  inputSchema: SkillTelemetryEmitInputSchema,
  execute: async (ctx) => {
    const input = SkillTelemetryEmitInputSchema.parse(ctx.input);
    safeTrack({
      name: EventName.SkillInvoked,
      props: { skillName: input.skillName, trigger: input.trigger },
    });
    return { content: "ok", isError: false, data: { recorded: true } };
  },
};

// Records structured failure-mode events (AI classification + suggested action +
// user's actual choice) so we can later measure classification accuracy and
// refine guidance. See plugin/skills/_shared/failure-mode-handling.md.
const telemetryEventEmitTool: ILocalMcpTool = {
  name: "muggle-local-telemetry-event-emit",
  description:
    "Emit a structured failure-mode telemetry event recording how a Muggle Test skill " +
    "classified a situation and what action the user took. Used at five decision points: " +
    "'pre-execution-classification' (replay vs regen), 'replay-failure-classified', " +
    "'replay-failure-resolved', 'regen-failure-classified', 'regen-failure-resolved'. " +
    "Records to ~/.muggle-ai/telemetry/failure-events.jsonl. Never fails the skill on telemetry errors.",
  inputSchema: EventTelemetryEmitInputSchema,
  execute: async (ctx) => {
    const input = EventTelemetryEmitInputSchema.parse(ctx.input);
    appendFailureEvent({
      eventType: input.eventType,
      skillName: input.skillName,
      aiClassification: input.aiClassification,
      aiSuggestion: input.aiSuggestion,
      userAction: input.userAction,
      runId: input.runId,
      testCaseId: input.testCaseId,
      projectId: input.projectId,
      signals: input.signals,
      metadata: input.metadata,
    });
    return { content: "ok", isError: false, data: { recorded: true } };
  },
};


/**
 * All registered local E2E execution tools.
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
  // Preferences tools
  preferencesSetTool,
  // Last-project cache tools (per-repo "last used Muggle Test project")
  lastProjectGetTool,
  lastProjectSetTool,
  lastProjectClearTool,
  // Last-host cache tools (per-repo "last used local dev server URL")
  lastHostGetTool,
  lastHostSetTool,
  lastHostClearTool,
  // Client telemetry: skills emit invocation events through this tool
  telemetrySkillEmitTool,
  telemetryEventEmitTool,
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

  // Telemetry around the dispatch — must never throw out of this function.
  const startTime = Date.now();
  safeTrack({
    name: EventName.McpToolInvoked,
    props: { toolName: name, toolSurface: ToolSurface.Local, correlationId: correlationId },
  });
  try {
    const result = await tool.execute({ input: input, correlationId: correlationId });
    safeTrack({
      name: EventName.McpToolCompleted,
      props: {
        toolName: name,
        toolSurface: ToolSurface.Local,
        correlationId: correlationId,
        durationMs: Date.now() - startTime,
        outcome: result.isError ? Outcome.Error : Outcome.Success,
      },
    });
    return result;
  } catch (err) {
    safeTrack({
      name: EventName.McpToolCompleted,
      props: {
        toolName: name,
        toolSurface: ToolSurface.Local,
        correlationId: correlationId,
        durationMs: Date.now() - startTime,
        outcome: Outcome.Error,
        errorCode: err instanceof Error ? err.name : "UnknownError",
      },
    });
    throw err;
  }
}

// Defensive wrapper — telemetry must never propagate exceptions to the host.
function safeTrack(event: Parameters<typeof track>[0]): void {
  try {
    track(event);
  } catch {
    // intentionally swallowed
  }
}
