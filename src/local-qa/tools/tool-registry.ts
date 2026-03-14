/**
 * Tool registry for local-qa.
 * Manages all available tools and provides lookup functionality.
 */

import { getLogger } from "../../shared/logger.js";
import type { IMcpToolResult, ILocalMcpTool } from "../types/index.js";
import {
  EmptyInputSchema,
  AuthLoginInputSchema,
  AuthPollInputSchema,
  ListSessionsInputSchema,
  CleanupSessionsInputSchema,
  ProjectCreateInputSchema,
  ProjectIdInputSchema,
  ProjectUpdateInputSchema,
  UseCaseSaveInputSchema,
  UseCaseListInputSchema,
  UseCaseGetInputSchema,
  UseCaseUpdateInputSchema,
  UseCaseDeleteInputSchema,
  TestCaseSaveInputSchema,
  TestCaseListInputSchema,
  TestCaseGetInputSchema,
  TestCaseUpdateInputSchema,
  TestCaseDeleteInputSchema,
  TestScriptSaveInputSchema,
  TestScriptListInputSchema,
  TestScriptGetInputSchema,
  TestScriptDeleteInputSchema,
  RunResultListInputSchema,
  RunResultGetInputSchema,
  ExecuteTestGenerationInputSchema,
  ExecuteReplayInputSchema,
  CancelExecutionInputSchema,
  SecretCreateInputSchema,
  SecretListInputSchema,
  SecretGetInputSchema,
  SecretUpdateInputSchema,
  SecretDeleteInputSchema,
  PublishProjectInputSchema,
  PublishTestScriptInputSchema,
  WorkflowFileCreateInputSchema,
  WorkflowFileListInputSchema,
  WorkflowFileListAvailableInputSchema,
  WorkflowFileGetInputSchema,
  WorkflowFileUpdateInputSchema,
  WorkflowFileDeleteInputSchema,
  CloudProjectListInputSchema,
  CloudPullProjectInputSchema,
  CloudPullUseCaseInputSchema,
  CloudPullTestCaseInputSchema,
  CloudSecretCreateInputSchema,
  CloudSecretListInputSchema,
  CloudSecretGetInputSchema,
  CloudSecretUpdateInputSchema,
  CloudSecretDeleteInputSchema,
  CloudWorkflowFileCreateInputSchema,
  CloudWorkflowFileListInputSchema,
  CloudWorkflowFileListAvailableInputSchema,
  CloudWorkflowFileGetInputSchema,
  CloudWorkflowFileUpdateInputSchema,
  CloudWorkflowFileDeleteInputSchema,
  RunTestInputSchema,
  ExplorePageInputSchema,
  ExecuteActionInputSchema,
  GetScreenshotInputSchema,
  GetPageStateInputSchema,
} from "../contracts/index.js";
import {
  cancelExecution,
  executeReplay,
  executeTestGeneration,
  getAuthService,
  getProjectStorageService,
  getStorageService,
} from "../services/index.js";
import { DeviceCodePollStatus, LocalTestScriptStatus, LocalWorkflowFileEntityType } from "../types/index.js";
import type { ILocalWorkflowFile } from "../types/index.js";

/**
 * Create a child logger for correlation.
 */
function createChildLogger (correlationId: string) {
  const logger = getLogger();
  return {
    info: (msg: string, meta?: Record<string, unknown>) => logger.info(msg, { ...meta, correlationId: correlationId }),
    error: (msg: string, meta?: Record<string, unknown>) => logger.error(msg, { ...meta, correlationId: correlationId }),
    warn: (msg: string, meta?: Record<string, unknown>) => logger.warn(msg, { ...meta, correlationId: correlationId }),
    debug: (msg: string, meta?: Record<string, unknown>) => logger.debug(msg, { ...meta, correlationId: correlationId }),
  };
}

// ========================================
// Auth Tools
// ========================================

const authStatusTool: ILocalMcpTool = {
  name: "muggle_auth_status",
  description: "Check current authentication status. Shows if you're logged in and when your session expires.",
  inputSchema: EmptyInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_auth_status");

    const authService = getAuthService();
    const status = authService.getAuthStatus();

    if (!status.authenticated) {
      return {
        content: "Not authenticated. Use muggle_auth_login to authenticate.",
        isError: false,
        data: { authenticated: false },
      };
    }

    const content = [
      "## Authentication Status",
      "",
      `**Authenticated:** Yes`,
      `**Email:** ${status.email ?? "N/A"}`,
      `**User ID:** ${status.userId ?? "N/A"}`,
      `**Expires:** ${status.expiresAt}`,
      status.isExpired ? "**Warning:** Token has expired. Please re-authenticate." : "",
    ].filter(Boolean).join("\n");

    return { content: content, isError: false, data: status };
  },
};

const authLoginTool: ILocalMcpTool = {
  name: "muggle_auth_login",
  description: "Start authentication with the Muggle Test service. Opens a browser-based login flow and waits for confirmation by default. If login is still pending after the wait timeout, use muggle_auth_poll to finish authentication.",
  inputSchema: AuthLoginInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_auth_login");

    const input = AuthLoginInputSchema.parse(ctx.input);
    const authService = getAuthService();

    try {
      const deviceCodeResponse = await authService.startDeviceCodeFlow();
      const waitForCompletion = input.waitForCompletion ?? true;

      if (!waitForCompletion) {
        return {
          content: [
            "## Login Started",
            "",
            `**User Code:** ${deviceCodeResponse.userCode}`,
            `**Verification URL:** ${deviceCodeResponse.verificationUri}`,
            "",
            deviceCodeResponse.browserOpened
              ? "A browser window has been opened. Please complete the login there."
              : `Please open the URL above and enter the code.`,
            "",
            "After completing login in your browser, call `muggle_auth_poll` to finish.",
          ].join("\n"),
          isError: false,
          data: {
            deviceCode: deviceCodeResponse.deviceCode,
            userCode: deviceCodeResponse.userCode,
            verificationUri: deviceCodeResponse.verificationUri,
            browserOpened: deviceCodeResponse.browserOpened,
          },
        };
      }

      const pollResult = await authService.waitForDeviceCodeAuthorization({
        deviceCode: deviceCodeResponse.deviceCode,
        intervalSeconds: deviceCodeResponse.interval,
        timeoutMs: input.timeoutMs,
      });

      if (pollResult.status === DeviceCodePollStatus.Complete) {
        return {
          content: `## Login Successful\n\n**Email:** ${pollResult.email ?? "N/A"}\n\nYou are now authenticated.`,
          isError: false,
          data: { success: true, email: pollResult.email },
        };
      }

      return {
        content: [
          "## Login Pending",
          "",
          pollResult.message,
          "",
          "Use `muggle_auth_poll` to check for completion.",
        ].join("\n"),
        isError: false,
        data: { status: pollResult.status, message: pollResult.message },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Login failed", { error: errorMessage });
      return { content: `Login failed: ${errorMessage}`, isError: true };
    }
  },
};

const authPollTool: ILocalMcpTool = {
  name: "muggle_auth_poll",
  description: "Poll for login completion after starting the login flow with muggle_auth_login. Call this after the user completes authentication in their browser.",
  inputSchema: AuthPollInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_auth_poll");

    const input = AuthPollInputSchema.parse(ctx.input);
    const authService = getAuthService();

    const deviceCode = input.deviceCode ?? authService.getPendingDeviceCode();

    if (!deviceCode) {
      return {
        content: "No pending login found. Please start a new login with muggle_auth_login.",
        isError: true,
      };
    }

    try {
      const result = await authService.pollDeviceCode(deviceCode);

      if (result.status === DeviceCodePollStatus.Complete) {
        return {
          content: `## Login Complete\n\n**Email:** ${result.email ?? "N/A"}\n\nYou are now authenticated.`,
          isError: false,
          data: { success: true, email: result.email },
        };
      }

      return {
        content: result.message,
        isError: result.status === DeviceCodePollStatus.Error,
        data: { status: result.status, message: result.message },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Poll failed", { error: errorMessage });
      return { content: `Poll failed: ${errorMessage}`, isError: true };
    }
  },
};

const authLogoutTool: ILocalMcpTool = {
  name: "muggle_auth_logout",
  description: "Log out and clear stored credentials.",
  inputSchema: EmptyInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_auth_logout");

    const authService = getAuthService();
    const result = authService.logout();

    if (result) {
      return { content: "Successfully logged out.", isError: false };
    }

    return { content: "No active session to log out from.", isError: false };
  },
};

// ========================================
// Session Tools
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

const cleanupSessionsTool: ILocalMcpTool = {
  name: "muggle_cleanup_sessions",
  description: "Clean up old testing sessions to free disk space. Deletes sessions older than the specified age (default: 30 days).",
  inputSchema: CleanupSessionsInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cleanup_sessions");

    const input = CleanupSessionsInputSchema.parse(ctx.input);
    const storageService = getStorageService();
    const deleted = storageService.cleanupOldSessions({ maxAgeDays: input.max_age_days });

    return {
      content: `Cleaned up ${deleted} old session(s).`,
      isError: false,
      data: { deletedCount: deleted },
    };
  },
};

// ========================================
// Project Tools
// ========================================

const projectCreateTool: ILocalMcpTool = {
  name: "muggle_project_create",
  description: "Create a new local project for testing. Projects store use cases, test cases, and test scripts locally.",
  inputSchema: ProjectCreateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_project_create");

    const input = ProjectCreateInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const project = storage.createProject({
        name: input.name,
        description: input.description,
        url: input.url,
      });

      const content = [
        "## Project Created",
        "",
        `**Project ID:** ${project.id}`,
        `**Name:** ${project.name}`,
        `**URL:** ${project.url}`,
        `**Description:** ${project.description}`,
        "",
        `**Local Path:** ${storage.getProjectPath(project.id)}`,
        "",
        "You can now create use cases and test cases for this project.",
      ].join("\n");

      return { content: content, isError: false, data: project };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to create project", { error: errorMessage });
      return { content: `Failed to create project: ${errorMessage}`, isError: true };
    }
  },
};

const projectListTool: ILocalMcpTool = {
  name: "muggle_project_list",
  description: "List all local projects.",
  inputSchema: EmptyInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_project_list");

    const storage = getProjectStorageService();
    const projects = storage.listProjects();

    if (projects.length === 0) {
      return { content: "No projects found. Use muggle_project_create to create one.", isError: false, data: { projects: [] } };
    }

    const lines = projects.map((p) => {
      return `- **${p.name}** (${p.id}) - ${p.url}`;
    });

    const content = ["## Local Projects", "", ...lines].join("\n");

    return { content: content, isError: false, data: { projects: projects } };
  },
};

const projectGetTool: ILocalMcpTool = {
  name: "muggle_project_get",
  description: "Get details of a local project including statistics.",
  inputSchema: ProjectIdInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_project_get");

    const input = ProjectIdInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const project = storage.getProject(input.projectId);

    if (!project) {
      return { content: `Project not found: ${input.projectId}`, isError: true };
    }

    const useCases = storage.listUseCases(project.id);
    const testCases = storage.listTestCases({ projectId: project.id });
    const testScripts = storage.listTestScripts({ projectId: project.id });

    const content = [
      "## Project Details",
      "",
      `**ID:** ${project.id}`,
      `**Name:** ${project.name}`,
      `**URL:** ${project.url}`,
      `**Description:** ${project.description}`,
      "",
      "### Statistics",
      `- Use Cases: ${useCases.length}`,
      `- Test Cases: ${testCases.length}`,
      `- Test Scripts: ${testScripts.length}`,
    ].join("\n");

    return {
      content: content,
      isError: false,
      data: {
        project: project,
        stats: {
          useCases: useCases.length,
          testCases: testCases.length,
          testScripts: testScripts.length,
        },
      },
    };
  },
};

const projectUpdateTool: ILocalMcpTool = {
  name: "muggle_project_update",
  description: "Update a local project's name, description, or URL.",
  inputSchema: ProjectUpdateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_project_update");

    const input = ProjectUpdateInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const project = storage.updateProject({
        id: input.projectId,
        name: input.name,
        description: input.description,
        url: input.url,
      });

      return {
        content: `Project updated: ${project.name}`,
        isError: false,
        data: project,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to update project", { error: errorMessage });
      return { content: `Failed to update project: ${errorMessage}`, isError: true };
    }
  },
};

const projectDeleteTool: ILocalMcpTool = {
  name: "muggle_project_delete",
  description: "Delete a local project and all its contents (use cases, test cases, test scripts).",
  inputSchema: ProjectIdInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_project_delete");

    const input = ProjectIdInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const deleted = storage.deleteProject(input.projectId);

    if (deleted) {
      return { content: `Project deleted: ${input.projectId}`, isError: false };
    }

    return { content: `Project not found: ${input.projectId}`, isError: true };
  },
};

// ========================================
// Use Case Tools
// ========================================

const useCaseSaveTool: ILocalMcpTool = {
  name: "muggle_use_case_save",
  description: "Save a use case (from preview API) to local storage. Use qa_use_case_prompt_preview to generate the use case first.",
  inputSchema: UseCaseSaveInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_use_case_save");

    const input = UseCaseSaveInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const useCase = storage.saveUseCase({
        projectId: input.projectId,
        title: input.useCase.title,
        userStory: input.useCase.userStory,
        description: input.useCase.description,
        breakdownItems: input.useCase.breakdownItems,
      });

      return {
        content: `Use case saved: ${useCase.title} (${useCase.id})`,
        isError: false,
        data: useCase,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to save use case", { error: errorMessage });
      return { content: `Failed to save use case: ${errorMessage}`, isError: true };
    }
  },
};

const useCaseListTool: ILocalMcpTool = {
  name: "muggle_use_case_list",
  description: "List all use cases for a local project.",
  inputSchema: UseCaseListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_use_case_list");

    const input = UseCaseListInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const useCases = storage.listUseCases(input.projectId);

    if (useCases.length === 0) {
      return { content: "No use cases found.", isError: false, data: { useCases: [] } };
    }

    const lines = useCases.map((uc) => `- **${uc.title}** (${uc.id})`);
    const content = ["## Use Cases", "", ...lines].join("\n");

    return { content: content, isError: false, data: { useCases: useCases } };
  },
};

const useCaseGetTool: ILocalMcpTool = {
  name: "muggle_use_case_get",
  description: "Get details of a local use case.",
  inputSchema: UseCaseGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_use_case_get");

    const input = UseCaseGetInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const useCase = storage.getUseCase({ projectId: input.projectId, useCaseId: input.useCaseId });

    if (!useCase) {
      return { content: `Use case not found: ${input.useCaseId}`, isError: true };
    }

    const content = [
      "## Use Case Details",
      "",
      `**ID:** ${useCase.id}`,
      `**Title:** ${useCase.title}`,
      useCase.userStory ? `**User Story:** ${useCase.userStory}` : "",
      useCase.description ? `**Description:** ${useCase.description}` : "",
    ].filter(Boolean).join("\n");

    return { content: content, isError: false, data: useCase };
  },
};

const useCaseUpdateTool: ILocalMcpTool = {
  name: "muggle_use_case_update",
  description: "Update an existing local use case with new values. Only provided fields will be updated.",
  inputSchema: UseCaseUpdateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_use_case_update");

    const input = UseCaseUpdateInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const useCase = storage.updateUseCase({
        projectId: input.projectId,
        useCaseId: input.useCaseId,
        updates: {
          title: input.title,
          userStory: input.userStory,
          description: input.description,
          breakdownItems: input.breakdownItems,
        },
      });

      return { content: `Use case updated: ${useCase.title}`, isError: false, data: useCase };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to update use case", { error: errorMessage });
      return { content: `Failed to update use case: ${errorMessage}`, isError: true };
    }
  },
};

const useCaseDeleteTool: ILocalMcpTool = {
  name: "muggle_use_case_delete",
  description: "Delete a local use case.",
  inputSchema: UseCaseDeleteInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_use_case_delete");

    const input = UseCaseDeleteInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const deleted = storage.deleteUseCase({ projectId: input.projectId, useCaseId: input.useCaseId });

    if (deleted) {
      return { content: `Use case deleted: ${input.useCaseId}`, isError: false };
    }

    return { content: `Use case not found: ${input.useCaseId}`, isError: true };
  },
};

// ========================================
// Test Case Tools
// ========================================

const testCaseSaveTool: ILocalMcpTool = {
  name: "muggle_test_case_save",
  description: "Save a test case (from preview API) to local storage. Use qa_test_case_generate_from_prompt to generate test cases first.",
  inputSchema: TestCaseSaveInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_case_save");

    const input = TestCaseSaveInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const testCase = storage.saveTestCase({
        projectId: input.projectId,
        useCaseId: input.useCaseId,
        title: input.testCase.title,
        description: input.testCase.description,
        goal: input.testCase.goal,
        precondition: input.testCase.precondition,
        instructions: input.testCase.instructions,
        expectedResult: input.testCase.expectedResult,
        url: input.testCase.url,
      });

      return {
        content: `Test case saved: ${testCase.title} (${testCase.id})`,
        isError: false,
        data: testCase,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to save test case", { error: errorMessage });
      return { content: `Failed to save test case: ${errorMessage}`, isError: true };
    }
  },
};

const testCaseListTool: ILocalMcpTool = {
  name: "muggle_test_case_list",
  description: "List test cases for a local project, optionally filtered by use case.",
  inputSchema: TestCaseListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_case_list");

    const input = TestCaseListInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const testCases = storage.listTestCases({ projectId: input.projectId, useCaseId: input.useCaseId });

    if (testCases.length === 0) {
      return { content: "No test cases found.", isError: false, data: { testCases: [] } };
    }

    const lines = testCases.map((tc) => `- **${tc.title}** (${tc.id})`);
    const content = ["## Test Cases", "", ...lines].join("\n");

    return { content: content, isError: false, data: { testCases: testCases } };
  },
};

const testCaseGetTool: ILocalMcpTool = {
  name: "muggle_test_case_get",
  description: "Get details of a local test case.",
  inputSchema: TestCaseGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_case_get");

    const input = TestCaseGetInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const testCase = storage.getTestCase({ projectId: input.projectId, testCaseId: input.testCaseId });

    if (!testCase) {
      return { content: `Test case not found: ${input.testCaseId}`, isError: true };
    }

    const content = [
      "## Test Case Details",
      "",
      `**ID:** ${testCase.id}`,
      `**Title:** ${testCase.title}`,
      `**Goal:** ${testCase.goal}`,
      `**URL:** ${testCase.url}`,
      testCase.precondition ? `**Precondition:** ${testCase.precondition}` : "",
      `**Expected Result:** ${testCase.expectedResult}`,
    ].filter(Boolean).join("\n");

    return { content: content, isError: false, data: testCase };
  },
};

const testCaseUpdateTool: ILocalMcpTool = {
  name: "muggle_test_case_update",
  description: "Update an existing local test case with new values. Only provided fields will be updated.",
  inputSchema: TestCaseUpdateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_case_update");

    const input = TestCaseUpdateInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const testCase = storage.updateTestCase({
        projectId: input.projectId,
        testCaseId: input.testCaseId,
        updates: {
          title: input.title,
          description: input.description,
          goal: input.goal,
          precondition: input.precondition,
          instructions: input.instructions,
          expectedResult: input.expectedResult,
          url: input.url,
        },
      });

      return { content: `Test case updated: ${testCase.title}`, isError: false, data: testCase };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to update test case", { error: errorMessage });
      return { content: `Failed to update test case: ${errorMessage}`, isError: true };
    }
  },
};

const testCaseDeleteTool: ILocalMcpTool = {
  name: "muggle_test_case_delete",
  description: "Delete a local test case.",
  inputSchema: TestCaseDeleteInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_case_delete");

    const input = TestCaseDeleteInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const deleted = storage.deleteTestCase({ projectId: input.projectId, testCaseId: input.testCaseId });

    if (deleted) {
      return { content: `Test case deleted: ${input.testCaseId}`, isError: false };
    }

    return { content: `Test case not found: ${input.testCaseId}`, isError: true };
  },
};

// ========================================
// Test Script Tools
// ========================================

const testScriptListTool: ILocalMcpTool = {
  name: "muggle_test_script_list",
  description: "List all test scripts in a project, optionally filtered by test case.",
  inputSchema: TestScriptListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_script_list");

    const input = TestScriptListInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const testScripts = storage.listTestScripts({ projectId: input.projectId, testCaseId: input.testCaseId });

    if (testScripts.length === 0) {
      return { content: "No test scripts found.", isError: false, data: { testScripts: [] } };
    }

    const lines = testScripts.map((ts) => `- **${ts.name}** (${ts.id}) - ${ts.status}`);
    const content = ["## Test Scripts", "", ...lines].join("\n");

    return { content: content, isError: false, data: { testScripts: testScripts } };
  },
};

const testScriptGetTool: ILocalMcpTool = {
  name: "muggle_test_script_get",
  description: "Get details of a local test script including action script steps.",
  inputSchema: TestScriptGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_script_get");

    const input = TestScriptGetInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const testScript = storage.getTestScript({ projectId: input.projectId, testScriptId: input.testScriptId });

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

const testScriptSaveTool: ILocalMcpTool = {
  name: "muggle_test_script_save",
  description: "Save a test script locally. Test scripts are typically generated by muggle_execute_test_generation, but can also be manually saved.",
  inputSchema: TestScriptSaveInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_script_save");

    const input = TestScriptSaveInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const testScript = storage.createTestScript({
        projectId: input.projectId,
        useCaseId: input.useCaseId,
        testCaseId: input.testCaseId,
        name: input.testScript.name,
        url: input.testScript.url,
      });

      if (input.testScript.actionScript) {
        storage.updateTestScript({
          projectId: input.projectId,
          testScriptId: testScript.id,
          updates: {
            goal: input.testScript.goal,
            description: input.testScript.description,
            precondition: input.testScript.precondition,
            expectedResult: input.testScript.expectedResult,
            actionScriptId: input.testScript.actionScriptId,
            actionScript: input.testScript.actionScript,
            status: LocalTestScriptStatus.GENERATED,
          },
        });
      }

      return {
        content: `Test script saved: ${testScript.name} (${testScript.id})`,
        isError: false,
        data: testScript,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to save test script", { error: errorMessage });
      return { content: `Failed to save test script: ${errorMessage}`, isError: true };
    }
  },
};

const testScriptDeleteTool: ILocalMcpTool = {
  name: "muggle_test_script_delete",
  description: "Delete a local test script. Note: This only deletes the local copy; cloud copies remain.",
  inputSchema: TestScriptDeleteInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_test_script_delete");

    const input = TestScriptDeleteInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const deleted = storage.deleteTestScript({ projectId: input.projectId, testScriptId: input.testScriptId });

    if (deleted) {
      return { content: `Test script deleted: ${input.testScriptId}`, isError: false };
    }

    return { content: `Test script not found: ${input.testScriptId}`, isError: true };
  },
};

// ========================================
// Run Result Tools
// ========================================

const runResultListTool: ILocalMcpTool = {
  name: "muggle_run_result_list",
  description: "List run results (test generation and replay history) for a project, optionally filtered by test script.",
  inputSchema: RunResultListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_run_result_list");

    const input = RunResultListInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    let results = storage.listRunResults(input.projectId);

    if (input.testScriptId) {
      results = results.filter((r) => r.testScriptId === input.testScriptId);
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
    const storage = getProjectStorageService();
    const result = storage.getRunResult({ projectId: input.projectId, runId: input.runId });

    if (!result) {
      return { content: `Run result not found: ${input.runId}`, isError: true };
    }

    const content = [
      "## Run Result Details",
      "",
      `**ID:** ${result.id}`,
      `**Type:** ${result.runType}`,
      `**Status:** ${result.status}`,
      `**Test Script:** ${result.testScriptId}`,
      `**Duration:** ${result.executionTimeMs ?? 0}ms`,
      result.errorMessage ? `**Error:** ${result.errorMessage}` : "",
    ].filter(Boolean).join("\n");

    return { content: content, isError: false, data: result };
  },
};

// ========================================
// Execution Tools (Placeholder - requires electron-app)
// ========================================

const executeTestGenerationTool: ILocalMcpTool = {
  name: "muggle_execute_test_generation",
  description: "Execute test script generation for a test case. Requires explicit approval before launching electron-app in explore mode.",
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
          "**Note:** The electron-app will open a browser window and navigate to your test URL.",
        ].join("\n"),
        isError: false,
        data: { requiresApproval: true },
      };
    }

    try {
      const result = await executeTestGeneration({
        projectId: input.projectId,
        testCaseId: input.testCaseId,
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
  description: "Execute test script replay. Requires explicit approval before launching electron-app in engine mode.",
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
          "**Note:** The electron-app will open a browser window and execute the test steps.",
        ].join("\n"),
        isError: false,
        data: { requiresApproval: true },
      };
    }

    try {
      const result = await executeReplay({
        projectId: input.projectId,
        testScriptId: input.testScriptId,
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
// Secret Tools
// ========================================

const secretCreateTool: ILocalMcpTool = {
  name: "muggle_secret_create",
  description: "Create a local secret for a project. Secret values are stored locally and never returned in tool output.",
  inputSchema: SecretCreateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_secret_create");

    const input = SecretCreateInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const secret = storage.saveSecret({
        projectId: input.projectId,
        secretName: input.secretName,
        value: input.value,
        description: input.description,
        source: input.source,
      });

      return {
        content: `Secret created: ${secret.secretName} (${secret.id})`,
        isError: false,
        data: { id: secret.id, secretName: secret.secretName },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to create secret", { error: errorMessage });
      return { content: `Failed to create secret: ${errorMessage}`, isError: true };
    }
  },
};

const secretListTool: ILocalMcpTool = {
  name: "muggle_secret_list",
  description: "List local secret metadata for a project without exposing secret values.",
  inputSchema: SecretListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_secret_list");

    const input = SecretListInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const secrets = storage.listSecrets(input.projectId);

    if (secrets.length === 0) {
      return { content: "No secrets found.", isError: false, data: { secrets: [] } };
    }

    const lines = secrets.map((s) => `- **${s.secretName}** (${s.id}) - ${s.description}`);
    const content = ["## Secrets", "", ...lines].join("\n");

    // Return metadata without values
    const metadata = secrets.map((s) => ({
      id: s.id,
      secretName: s.secretName,
      description: s.description,
      source: s.source,
    }));

    return { content: content, isError: false, data: { secrets: metadata } };
  },
};

const secretGetTool: ILocalMcpTool = {
  name: "muggle_secret_get",
  description: "Get local secret metadata by ID without exposing the secret value.",
  inputSchema: SecretGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_secret_get");

    const input = SecretGetInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const secret = storage.getSecret({ projectId: input.projectId, secretId: input.secretId });

    if (!secret) {
      return { content: `Secret not found: ${input.secretId}`, isError: true };
    }

    const content = [
      "## Secret Details",
      "",
      `**ID:** ${secret.id}`,
      `**Name:** ${secret.secretName}`,
      `**Description:** ${secret.description}`,
      secret.source ? `**Source:** ${secret.source}` : "",
    ].filter(Boolean).join("\n");

    return {
      content: content,
      isError: false,
      data: { id: secret.id, secretName: secret.secretName, description: secret.description },
    };
  },
};

const secretUpdateTool: ILocalMcpTool = {
  name: "muggle_secret_update",
  description: "Update a local secret. Secret values are stored but never returned in tool output.",
  inputSchema: SecretUpdateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_secret_update");

    const input = SecretUpdateInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const secret = storage.updateSecret({
        projectId: input.projectId,
        secretId: input.secretId,
        updates: {
          secretName: input.secretName,
          value: input.value,
          description: input.description,
          source: input.source,
        },
      });

      return {
        content: `Secret updated: ${secret.secretName}`,
        isError: false,
        data: { id: secret.id, secretName: secret.secretName },
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to update secret", { error: errorMessage });
      return { content: `Failed to update secret: ${errorMessage}`, isError: true };
    }
  },
};

const secretDeleteTool: ILocalMcpTool = {
  name: "muggle_secret_delete",
  description: "Delete a local secret.",
  inputSchema: SecretDeleteInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_secret_delete");

    const input = SecretDeleteInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const deleted = storage.deleteSecret({ projectId: input.projectId, secretId: input.secretId });

    if (deleted) {
      return { content: `Secret deleted: ${input.secretId}`, isError: false };
    }

    return { content: `Secret not found: ${input.secretId}`, isError: true };
  },
};

// ========================================
// Local Workflow File Tools
// ========================================

const workflowFileCreateTool: ILocalMcpTool = {
  name: "muggle_workflow_file_create",
  description: "Create a local workflow file by copying a file into project storage and assigning scope associations.",
  inputSchema: WorkflowFileCreateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_workflow_file_create");

    const input = WorkflowFileCreateInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const workflowFile = storage.saveWorkflowFile({
        projectId: input.projectId,
        sourceFilePath: input.filePath,
        description: input.description,
        tags: input.tags,
        associations: input.associations?.map((a) => ({
          entityType: a.entityType as LocalWorkflowFileEntityType,
          entityId: a.entityId,
        })),
      });

      return {
        content: `Workflow file created: ${workflowFile.id}`,
        isError: false,
        data: workflowFile,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to create workflow file", { error: errorMessage });
      return { content: `Failed to create workflow file: ${errorMessage}`, isError: true };
    }
  },
};

const workflowFileListTool: ILocalMcpTool = {
  name: "muggle_workflow_file_list",
  description: "List local workflow files for a project.",
  inputSchema: WorkflowFileListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_workflow_file_list");

    const input = WorkflowFileListInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const files = storage.listWorkflowFiles(input.projectId);

    if (files.length === 0) {
      return { content: "No workflow files found.", isError: false, data: { files: [] } };
    }

    const lines = files.map((f) => `- **${f.id}** - ${f.description}`);
    const content = ["## Workflow Files", "", ...lines].join("\n");

    return { content: content, isError: false, data: { files: files } };
  },
};

const workflowFileListAvailableTool: ILocalMcpTool = {
  name: "muggle_workflow_file_list_available",
  description: "List local workflow files available to a use case or test case based on scope associations.",
  inputSchema: WorkflowFileListAvailableInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_workflow_file_list_available");

    const input = WorkflowFileListAvailableInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const files = storage.resolveWorkflowFilesForExecution({
      projectId: input.projectId,
      useCaseId: input.entityType === "use_case" ? input.entityId : undefined,
      testCaseId: input.entityType === "test_case" ? input.entityId : undefined,
    });

    if (files.length === 0) {
      return { content: "No available workflow files.", isError: false, data: { files: [] } };
    }

    const lines = files.map((f: ILocalWorkflowFile) => `- **${f.id}** - ${f.description}`);
    const content = ["## Available Workflow Files", "", ...lines].join("\n");

    return { content: content, isError: false, data: { files: files } };
  },
};

const workflowFileGetTool: ILocalMcpTool = {
  name: "muggle_workflow_file_get",
  description: "Get a local workflow file and its scope associations.",
  inputSchema: WorkflowFileGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_workflow_file_get");

    const input = WorkflowFileGetInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const file = storage.getWorkflowFile({ projectId: input.projectId, fileId: input.fileId });

    if (!file) {
      return { content: `Workflow file not found: ${input.fileId}`, isError: true };
    }

    const content = [
      "## Workflow File Details",
      "",
      `**ID:** ${file.id}`,
      `**Description:** ${file.description}`,
      file.tags?.length ? `**Tags:** ${file.tags.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    return { content: content, isError: false, data: file };
  },
};

const workflowFileUpdateTool: ILocalMcpTool = {
  name: "muggle_workflow_file_update",
  description: "Update local workflow file metadata and scope associations.",
  inputSchema: WorkflowFileUpdateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_workflow_file_update");

    const input = WorkflowFileUpdateInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();

    try {
      const file = storage.updateWorkflowFile({
        projectId: input.projectId,
        fileId: input.fileId,
        updates: {
          description: input.description,
          tags: input.tags,
          associations: input.associations?.map((a) => ({
            entityType: a.entityType as LocalWorkflowFileEntityType,
            entityId: a.entityId,
          })),
        },
      });

      return { content: `Workflow file updated: ${file.id}`, isError: false, data: file };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Failed to update workflow file", { error: errorMessage });
      return { content: `Failed to update workflow file: ${errorMessage}`, isError: true };
    }
  },
};

const workflowFileDeleteTool: ILocalMcpTool = {
  name: "muggle_workflow_file_delete",
  description: "Delete a local workflow file.",
  inputSchema: WorkflowFileDeleteInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_workflow_file_delete");

    const input = WorkflowFileDeleteInputSchema.parse(ctx.input);
    const storage = getProjectStorageService();
    const deleted = storage.deleteWorkflowFile({ projectId: input.projectId, fileId: input.fileId });

    if (deleted) {
      return { content: `Workflow file deleted: ${input.fileId}`, isError: false };
    }

    return { content: `Workflow file not found: ${input.fileId}`, isError: true };
  },
};

// ========================================
// Publishing Tools (Placeholder - requires prompt-service client)
// ========================================

const publishProjectTool: ILocalMcpTool = {
  name: "muggle_publish_project",
  description: "Publish a local project to the Muggle AI cloud. Creates or updates the cloud project and syncs use cases, test cases, and test scripts.",
  inputSchema: PublishProjectInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_publish_project");

    // TODO: Implement with prompt-service client
    return {
      content: "Project publishing is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const publishTestScriptTool: ILocalMcpTool = {
  name: "muggle_publish_test_script",
  description: "Check the cloud status of a test script. Test scripts are automatically uploaded to Firebase by electron-app during muggle_execute_test_generation. This tool verifies if the upload completed and returns the cloud reference.",
  inputSchema: PublishTestScriptInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_publish_test_script");

    // TODO: Implement with prompt-service client
    return {
      content: "Test script publishing is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

// ========================================
// Cloud Sync Tools (Placeholder - requires prompt-service client)
// ========================================

const cloudProjectListTool: ILocalMcpTool = {
  name: "muggle_cloud_project_list",
  description: "List all cloud projects for the authenticated user. Requires authentication.",
  inputSchema: CloudProjectListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_project_list");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud project listing is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudPullProjectTool: ILocalMcpTool = {
  name: "muggle_cloud_pull_project",
  description: "Pull a cloud project to local storage with URL rewritten to localhost. Downloads project, use cases, and test cases.",
  inputSchema: CloudPullProjectInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_pull_project");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud project pull is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudPullUseCaseTool: ILocalMcpTool = {
  name: "muggle_cloud_pull_use_case",
  description: "Pull a single cloud use case and its test cases to local storage with URL rewritten to localhost.",
  inputSchema: CloudPullUseCaseInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_pull_use_case");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud use case pull is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudPullTestCaseTool: ILocalMcpTool = {
  name: "muggle_cloud_pull_test_case",
  description: "Pull a single cloud test case to local storage with URL rewritten to localhost.",
  inputSchema: CloudPullTestCaseInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_pull_test_case");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud test case pull is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudSecretCreateTool: ILocalMcpTool = {
  name: "muggle_cloud_secret_create",
  description: "Create a cloud secret. Secret values are sent to prompt-service but never returned in tool output.",
  inputSchema: CloudSecretCreateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_secret_create");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud secret creation is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudSecretListTool: ILocalMcpTool = {
  name: "muggle_cloud_secret_list",
  description: "List cloud secret metadata for a project without exposing secret values.",
  inputSchema: CloudSecretListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_secret_list");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud secret listing is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudSecretGetTool: ILocalMcpTool = {
  name: "muggle_cloud_secret_get",
  description: "Get cloud secret metadata without exposing the secret value.",
  inputSchema: CloudSecretGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_secret_get");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud secret get is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudSecretUpdateTool: ILocalMcpTool = {
  name: "muggle_cloud_secret_update",
  description: "Update a cloud secret without returning the secret value.",
  inputSchema: CloudSecretUpdateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_secret_update");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud secret update is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudSecretDeleteTool: ILocalMcpTool = {
  name: "muggle_cloud_secret_delete",
  description: "Delete a cloud secret.",
  inputSchema: CloudSecretDeleteInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_secret_delete");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud secret deletion is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudWorkflowFileCreateTool: ILocalMcpTool = {
  name: "muggle_cloud_workflow_file_create",
  description: "Upload a workflow file to cloud storage with scope associations.",
  inputSchema: CloudWorkflowFileCreateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_workflow_file_create");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud workflow file creation is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudWorkflowFileListTool: ILocalMcpTool = {
  name: "muggle_cloud_workflow_file_list",
  description: "List cloud workflow files for a project.",
  inputSchema: CloudWorkflowFileListInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_workflow_file_list");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud workflow file listing is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudWorkflowFileListAvailableTool: ILocalMcpTool = {
  name: "muggle_cloud_workflow_file_list_available",
  description: "List cloud workflow files available to a scoped entity.",
  inputSchema: CloudWorkflowFileListAvailableInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_workflow_file_list_available");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud workflow file list available is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudWorkflowFileGetTool: ILocalMcpTool = {
  name: "muggle_cloud_workflow_file_get",
  description: "Get cloud workflow file metadata and scope associations.",
  inputSchema: CloudWorkflowFileGetInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_workflow_file_get");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud workflow file get is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudWorkflowFileUpdateTool: ILocalMcpTool = {
  name: "muggle_cloud_workflow_file_update",
  description: "Update cloud workflow file metadata and scope associations.",
  inputSchema: CloudWorkflowFileUpdateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_workflow_file_update");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud workflow file update is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

const cloudWorkflowFileDeleteTool: ILocalMcpTool = {
  name: "muggle_cloud_workflow_file_delete",
  description: "Delete a cloud workflow file.",
  inputSchema: CloudWorkflowFileDeleteInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_cloud_workflow_file_delete");

    // TODO: Implement with prompt-service client
    return {
      content: "Cloud workflow file deletion is not yet implemented in the unified package. This requires the prompt-service client.",
      isError: true,
    };
  },
};

// ========================================
// Test Execution Tools (Web Service Based - Placeholder)
// ========================================

const runTestTool: ILocalMcpTool = {
  name: "muggle_run_test",
  description: "Execute an AI-driven test flow against a web application. Provide a URL and natural language test instructions.",
  inputSchema: RunTestInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_run_test");

    // TODO: Implement with web-service client
    return {
      content: "AI-driven test execution is not yet implemented in the unified package. This requires the web-service client.",
      isError: true,
    };
  },
};

const explorePageTool: ILocalMcpTool = {
  name: "muggle_explore_page",
  description: "Navigate to a URL and return a structured analysis of the page including interactive elements, forms, and suggested actions.",
  inputSchema: ExplorePageInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_explore_page");

    // TODO: Implement with web-service client
    return {
      content: "Page exploration is not yet implemented in the unified package. This requires the web-service client.",
      isError: true,
    };
  },
};

const executeActionTool: ILocalMcpTool = {
  name: "muggle_execute_action",
  description: "Execute a single browser action (click, type, select, scroll, navigate, or wait) on the current page.",
  inputSchema: ExecuteActionInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_execute_action");

    // TODO: Implement with web-service client
    return {
      content: "Browser action execution is not yet implemented in the unified package. This requires the web-service client.",
      isError: true,
    };
  },
};

const getScreenshotTool: ILocalMcpTool = {
  name: "muggle_get_screenshot",
  description: "Capture the current page state as a screenshot. Optionally specify an execution ID or use the current active session.",
  inputSchema: GetScreenshotInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_get_screenshot");

    // TODO: Implement with web-service client
    return {
      content: "Screenshot capture is not yet implemented in the unified package. This requires the web-service client.",
      isError: true,
    };
  },
};

const getPageStateTool: ILocalMcpTool = {
  name: "muggle_get_page_state",
  description: "Get the current page state (URL, title) from the active browser session. Use this to understand where the browser is currently navigated.",
  inputSchema: GetPageStateInputSchema,
  execute: async (ctx) => {
    const logger = createChildLogger(ctx.correlationId);
    logger.info("Executing muggle_get_page_state");

    // TODO: Implement with web-service client
    return {
      content: "Page state retrieval is not yet implemented in the unified package. This requires the web-service client.",
      isError: true,
    };
  },
};

// ========================================
// All Tools Registry
// ========================================

/**
 * All registered local QA tools.
 */
export const allLocalQaTools: ILocalMcpTool[] = [
  // Auth tools
  authStatusTool,
  authLoginTool,
  authPollTool,
  authLogoutTool,
  // Session tools
  checkStatusTool,
  listSessionsTool,
  cleanupSessionsTool,
  getPageStateTool,
  // Project tools
  projectCreateTool,
  projectListTool,
  projectGetTool,
  projectUpdateTool,
  projectDeleteTool,
  // Local secret tools
  secretCreateTool,
  secretListTool,
  secretGetTool,
  secretUpdateTool,
  secretDeleteTool,
  // Local workflow file tools
  workflowFileCreateTool,
  workflowFileListTool,
  workflowFileListAvailableTool,
  workflowFileGetTool,
  workflowFileUpdateTool,
  workflowFileDeleteTool,
  // Use case tools
  useCaseSaveTool,
  useCaseListTool,
  useCaseGetTool,
  useCaseUpdateTool,
  useCaseDeleteTool,
  // Test case tools
  testCaseSaveTool,
  testCaseListTool,
  testCaseGetTool,
  testCaseUpdateTool,
  testCaseDeleteTool,
  // Test script tools
  testScriptSaveTool,
  testScriptListTool,
  testScriptGetTool,
  testScriptDeleteTool,
  // Run result tools
  runResultListTool,
  runResultGetTool,
  // Execution tools
  executeTestGenerationTool,
  executeReplayTool,
  cancelExecutionTool,
  // Publishing tools
  publishProjectTool,
  publishTestScriptTool,
  // Cloud sync tools
  cloudProjectListTool,
  cloudPullProjectTool,
  cloudPullUseCaseTool,
  cloudPullTestCaseTool,
  cloudSecretCreateTool,
  cloudSecretListTool,
  cloudSecretGetTool,
  cloudSecretUpdateTool,
  cloudSecretDeleteTool,
  cloudWorkflowFileCreateTool,
  cloudWorkflowFileListTool,
  cloudWorkflowFileListAvailableTool,
  cloudWorkflowFileGetTool,
  cloudWorkflowFileUpdateTool,
  cloudWorkflowFileDeleteTool,
  // Test execution tools (web-service based)
  runTestTool,
  explorePageTool,
  executeActionTool,
  getScreenshotTool,
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
export function getTool (name: string): ILocalMcpTool | undefined {
  return toolMap.get(name);
}

/**
 * Execute a tool by name.
 */
export async function executeTool (
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
