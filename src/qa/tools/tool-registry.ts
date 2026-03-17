/**
 * QA Tool registry - maps tool names to their implementations.
 */

import { z } from "zod";

import { getCallerCredentialsAsync } from "../../shared/auth.js";
import { getConfig } from "../../shared/config.js";
import { createChildLogger } from "../../shared/logger.js";
import type { IMcpToolResult } from "../../shared/types.js";

import * as schemas from "../contracts/index.js";
import { GatewayError, IQaToolDefinition, IUpstreamResponse } from "../types.js";
import { getPromptServiceClient } from "../upstream-client.js";
import { getAuthService } from "../../local-qa/services/index.js";
import { DeviceCodePollStatus } from "../../local-qa/types/index.js";

/** Muggle Test API prefix. */
const MUGGLE_TEST_PREFIX = "/v1/protected/muggle-test";

/** Default workflow timeout. */
const getWorkflowTimeoutMs = (): number => getConfig().qa.workflowTimeoutMs;

// =============================================================================
// Project Tools
// =============================================================================

const projectTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-project-create",
    description: "Create a new QA testing project. Projects organize use cases, test cases, and test scripts.",
    inputSchema: schemas.ProjectCreateInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ProjectCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects`,
        body: {
          name: data.projectName,
          description: data.description,
          url: data.url,
        },
      };
    },
  },
  {
    name: "muggle-remote-project-get",
    description: "Get details of a specific project by ID.",
    inputSchema: schemas.ProjectGetInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ProjectGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}`,
      };
    },
  },
  {
    name: "muggle-remote-project-update",
    description: "Update an existing project's details.",
    inputSchema: schemas.ProjectUpdateInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ProjectUpdateInputSchema>;
      const body: Record<string, unknown> = { id: data.projectId };
      if (data.projectName !== undefined) body.name = data.projectName;
      if (data.description !== undefined) body.description = data.description;
      if (data.url !== undefined) body.url = data.url;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}`,
        body: body,
      };
    },
  },
  {
    name: "muggle-remote-project-list",
    description: "List all projects accessible to the authenticated user.",
    inputSchema: schemas.ProjectListInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ProjectListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects`,
        queryParams: { page: data.page, pageSize: data.pageSize },
      };
    },
  },
  {
    name: "muggle-remote-project-delete",
    description: "Delete a project and all associated entities. This is a soft delete.",
    inputSchema: schemas.ProjectDeleteInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ProjectDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}`,
      };
    },
  },
];

// =============================================================================
// Use Case Tools
// =============================================================================

const useCaseTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-use-case-discovery-memory-get",
    description: "Get the use case discovery memory for a project, including all discovered use case candidates.",
    inputSchema: schemas.UseCaseDiscoveryMemoryGetInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.UseCaseDiscoveryMemoryGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/use-case-discovery-memory`,
      };
    },
  },
  {
    name: "muggle-remote-use-case-candidates-approve",
    description: "Approve (graduate) selected use case candidates into actual use cases.",
    inputSchema: schemas.UseCaseCandidatesApproveInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.UseCaseCandidatesApproveInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/use-case-discovery-memory/graduate`,
        body: { approveIds: data.approvedCandidateIds },
      };
    },
  },
  {
    name: "muggle-remote-use-case-list",
    description: "List all use cases for a project.",
    inputSchema: schemas.UseCaseListInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.UseCaseListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/use-cases`,
        queryParams: { projectId: data.projectId, page: data.page, pageSize: data.pageSize },
      };
    },
  },
  {
    name: "muggle-remote-use-case-get",
    description: "Get details of a specific use case by ID.",
    inputSchema: schemas.UseCaseGetInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.UseCaseGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/use-cases/${data.useCaseId}`,
      };
    },
  },
  {
    name: "muggle-remote-use-case-prompt-preview",
    description: "Preview a use case generated from a natural language instruction without saving.",
    inputSchema: schemas.UseCasePromptPreviewInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.UseCasePromptPreviewInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/use-cases/prompt/preview`,
        body: { instruction: data.instruction },
      };
    },
  },
  {
    name: "muggle-remote-use-case-create-from-prompts",
    description: "Create one or more use cases from natural language instructions.",
    inputSchema: schemas.UseCaseCreateFromPromptsInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.UseCaseCreateFromPromptsInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/use-cases/prompts/bulk`,
        body: { projectId: data.projectId, prompts: data.prompts },
      };
    },
  },
  {
    name: "muggle-remote-use-case-update-from-prompt",
    description: "Update an existing use case by regenerating its fields from a new instruction.",
    inputSchema: schemas.UseCaseUpdateFromPromptInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.UseCaseUpdateFromPromptInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/use-cases/${data.useCaseId}/prompt`,
        body: { instruction: data.instruction },
      };
    },
  },
];

// =============================================================================
// Test Case Tools
// =============================================================================

const testCaseTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-test-case-list",
    description: "List test cases for a project.",
    inputSchema: schemas.TestCaseListInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.TestCaseListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-cases`,
        queryParams: { projectId: data.projectId, page: data.page, pageSize: data.pageSize },
      };
    },
  },
  {
    name: "muggle-remote-test-case-get",
    description: "Get details of a specific test case.",
    inputSchema: schemas.TestCaseGetInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.TestCaseGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-cases/${data.testCaseId}`,
      };
    },
  },
  {
    name: "muggle-remote-test-case-list-by-use-case",
    description: "List test cases for a specific use case.",
    inputSchema: schemas.TestCaseListByUseCaseInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.TestCaseListByUseCaseInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/use-cases/${data.useCaseId}/test-cases`,
      };
    },
  },
  {
    name: "muggle-remote-test-case-generate-from-prompt",
    description: "Generate test cases from a natural language prompt. Returns preview test cases.",
    inputSchema: schemas.TestCaseGenerateFromPromptInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.TestCaseGenerateFromPromptInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/use-cases/${data.useCaseId}/test-cases/prompt/preview`,
        body: { instruction: data.instruction },
      };
    },
  },
  {
    name: "muggle-remote-test-case-create",
    description: "Create a new test case for a use case.",
    inputSchema: schemas.TestCaseCreateInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.TestCaseCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/test-cases`,
        body: {
          projectId: data.projectId,
          useCaseId: data.useCaseId,
          title: data.title,
          description: data.description,
          goal: data.goal,
          precondition: data.precondition,
          expectedResult: data.expectedResult,
          url: data.url,
          status: data.status || "DRAFT",
          priority: data.priority || "MEDIUM",
          tags: data.tags || [],
          category: data.category || "Functional",
          automated: data.automated ?? true,
        },
      };
    },
  },
];

// =============================================================================
// Test Script Tools
// =============================================================================

const testScriptTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-test-script-list",
    description: "List test scripts for a project.",
    inputSchema: schemas.TestScriptListInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.TestScriptListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-scripts`,
        queryParams: { projectId: data.projectId, page: data.page, pageSize: data.pageSize },
      };
    },
  },
  {
    name: "muggle-remote-test-script-get",
    description: "Get details of a specific test script.",
    inputSchema: schemas.TestScriptGetInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.TestScriptGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-scripts/${data.testScriptId}`,
      };
    },
  },
  {
    name: "muggle-remote-test-script-list-paginated",
    description: "List test scripts with full pagination support.",
    inputSchema: schemas.TestScriptListPaginatedInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.TestScriptListPaginatedInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-scripts/paginated`,
        queryParams: { projectId: data.projectId, page: data.page, pageSize: data.pageSize },
      };
    },
  },
];

// =============================================================================
// Workflow Tools
// =============================================================================

const workflowTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-workflow-start-website-scan",
    description: "Start a website scan workflow to discover use cases from a URL.",
    inputSchema: schemas.WorkflowStartWebsiteScanInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowStartWebsiteScanInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/website-scan`,
        body: {
          projectId: data.projectId,
          url: data.url,
          description: data.description,
          archiveUnapproved: data.archiveUnapproved,
          ...(data.workflowParams && { workflowParams: data.workflowParams }),
        },
        timeoutMs: getWorkflowTimeoutMs(),
      };
    },
  },
  {
    name: "muggle-remote-workflow-list-website-scan-runtimes",
    description: "List website scan workflow runtimes.",
    inputSchema: schemas.WorkflowListRuntimesInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowListRuntimesInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/website-scan/workflowRuntimes`,
        queryParams: { projectId: data.projectId },
      };
    },
  },
  {
    name: "muggle-remote-workflow-get-website-scan-latest-run",
    description: "Get the latest run status for a website scan workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/website-scan/${data.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-case-detection",
    description: "Start a test case detection workflow to generate test cases from use cases.",
    inputSchema: schemas.WorkflowStartTestCaseDetectionInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowStartTestCaseDetectionInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-case/test-case-detection`,
        body: {
          projectId: data.projectId,
          useCaseId: data.useCaseId,
          name: data.name,
          description: data.description,
          url: data.url,
          ...(data.workflowParams && { workflowParams: data.workflowParams }),
        },
        timeoutMs: getWorkflowTimeoutMs(),
      };
    },
  },
  {
    name: "muggle-remote-wf-list-tc-detect-runtimes",
    description: "List test case detection workflow runtimes.",
    inputSchema: schemas.WorkflowListRuntimesInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowListRuntimesInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-case/test-case-detection/workflowRuntimes`,
        queryParams: { projectId: data.projectId },
      };
    },
  },
  {
    name: "muggle-remote-wf-get-tc-detect-latest-run",
    description: "Get the latest run status for a test case detection workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-case/test-case-detection/${data.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-script-generation",
    description: "Start a test script generation workflow.",
    inputSchema: schemas.WorkflowStartTestScriptGenerationInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowStartTestScriptGenerationInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation`,
        body: {
          projectId: data.projectId,
          testCaseId: data.testCaseId,
          useCaseId: data.useCaseId,
          name: data.name,
          url: data.url,
          goal: data.goal,
          precondition: data.precondition,
          instructions: data.instructions,
          expectedResult: data.expectedResult,
          ...(data.workflowParams && { workflowParams: data.workflowParams }),
        },
        timeoutMs: getWorkflowTimeoutMs(),
      };
    },
  },
  {
    name: "muggle-remote-wf-get-ts-gen-latest-run",
    description: "Get the latest run status for a test script generation workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation/${data.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-wf-get-latest-ts-gen-by-tc",
    description: "Get the latest test script generation runtime for a specific test case.",
    inputSchema: schemas.WorkflowGetLatestScriptGenByTestCaseInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowGetLatestScriptGenByTestCaseInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation/testcases/${data.testCaseId}/runtime/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-script-replay",
    description: "Start a test script replay workflow to execute a single test script.",
    inputSchema: schemas.WorkflowStartTestScriptReplayInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowStartTestScriptReplayInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay`,
        body: {
          projectId: data.projectId,
          useCaseId: data.useCaseId,
          testCaseId: data.testCaseId,
          testScriptId: data.testScriptId,
          name: data.name,
          ...(data.workflowParams && { workflowParams: data.workflowParams }),
        },
        timeoutMs: getWorkflowTimeoutMs(),
      };
    },
  },
  {
    name: "muggle-remote-wf-get-ts-replay-latest-run",
    description: "Get the latest run status for a test script replay workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/${data.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-script-replay-bulk",
    description: "Start a bulk test script replay workflow to execute multiple test scripts.",
    inputSchema: schemas.WorkflowStartTestScriptReplayBulkInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowStartTestScriptReplayBulkInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/workflowRuntimes`,
        body: {
          projectId: data.projectId,
          name: data.name,
          intervalSec: data.intervalSec,
          useCaseId: data.useCaseId,
          namePrefix: data.namePrefix,
          limit: data.limit,
          testCaseIds: data.testCaseIds,
          repeatPerTestCase: data.repeatPerTestCase,
          ...(data.workflowParams && { workflowParams: data.workflowParams }),
        },
        timeoutMs: getWorkflowTimeoutMs(),
      };
    },
  },
  {
    name: "muggle-remote-wf-list-ts-replay-bulk-runtimes",
    description: "List bulk test script replay workflow runtimes.",
    inputSchema: schemas.WorkflowListRuntimesInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowListRuntimesInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/workflowRuntimes`,
        queryParams: { projectId: data.projectId },
      };
    },
  },
  {
    name: "muggle-remote-wf-get-ts-replay-bulk-latest-run",
    description: "Get the latest run status for a bulk test script replay workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/${data.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-wf-get-replay-bulk-batch-summary",
    description: "Get the summary of a bulk replay run batch.",
    inputSchema: schemas.WorkflowGetReplayBulkBatchSummaryInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowGetReplayBulkBatchSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/run-batch/${data.runBatchId}/summary`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-cancel-run",
    description: "Cancel a running workflow run.",
    inputSchema: schemas.WorkflowCancelRunInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowCancelRunInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/runs/${data.workflowRunId}/cancel`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-cancel-runtime",
    description: "Cancel a workflow runtime and all its runs.",
    inputSchema: schemas.WorkflowCancelRuntimeInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WorkflowCancelRuntimeInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/runtimes/${data.workflowRuntimeId}/cancel`,
      };
    },
  },
  {
    name: "muggle-remote-local-run-upload",
    description: "Upload a locally executed run (generation/replay) to cloud workflow records.",
    inputSchema: schemas.LocalRunUploadInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.LocalRunUploadInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/local-run/upload`,
        body: {
          projectId: data.projectId,
          useCaseId: data.useCaseId,
          testCaseId: data.testCaseId,
          runType: data.runType,
          productionUrl: data.productionUrl,
          localExecutionContext: {
            originalUrl: data.localExecutionContext.originalUrl,
            productionUrl: data.localExecutionContext.productionUrl,
            runByUserId: data.localExecutionContext.runByUserId,
            machineHostname: data.localExecutionContext.machineHostname,
            osInfo: data.localExecutionContext.osInfo,
            electronAppVersion: data.localExecutionContext.electronAppVersion,
            mcpServerVersion: data.localExecutionContext.mcpServerVersion,
            localExecutionCompletedAt: data.localExecutionContext.localExecutionCompletedAt,
            uploadedAt: data.localExecutionContext.uploadedAt,
          },
          actionScript: data.actionScript,
          status: data.status,
          executionTimeMs: data.executionTimeMs,
          errorMessage: data.errorMessage,
        },
      };
    },
  },
];

// =============================================================================
// Report Tools
// =============================================================================

const reportTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-project-test-results-summary-get",
    description: "Get a summary of test results for a project.",
    inputSchema: schemas.ProjectTestResultsSummaryInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ProjectTestResultsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/testResults`,
      };
    },
  },
  {
    name: "muggle-remote-project-test-scripts-summary-get",
    description: "Get a summary of test scripts for a project.",
    inputSchema: schemas.ProjectTestScriptsSummaryInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ProjectTestScriptsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/test-scripts/summary`,
      };
    },
  },
  {
    name: "muggle-remote-project-test-runs-summary-get",
    description: "Get a summary of test runs for a project.",
    inputSchema: schemas.ProjectTestRunsSummaryInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ProjectTestRunsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/test-runs/summary`,
      };
    },
  },
  {
    name: "muggle-remote-report-stats-summary-get",
    description: "Get report statistics summary for a project.",
    inputSchema: schemas.ReportStatsSummaryInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ReportStatsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/report/stats-summary`,
        queryParams: { projectId: data.projectId },
      };
    },
  },
  {
    name: "muggle-remote-report-cost-query",
    description: "Query cost/usage data for a project over a date range.",
    inputSchema: schemas.ReportCostQueryInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ReportCostQueryInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/report/cost/query`,
        body: {
          projectId: data.projectId,
          startDateKey: data.startDateKey,
          endDateKey: data.endDateKey,
          filterType: data.filterType,
          filterIds: data.filterIds,
        },
      };
    },
  },
  {
    name: "muggle-remote-report-preferences-upsert",
    description: "Update report delivery preferences for a project.",
    inputSchema: schemas.ReportPreferencesUpsertInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ReportPreferencesUpsertInputSchema>;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/report/preferences`,
        body: {
          projectId: data.projectId,
          channels: data.channels,
          emails: data.emails,
          phones: data.phones,
          webhookUrl: data.webhookUrl,
          defaultExportFormat: data.defaultExportFormat,
        },
      };
    },
  },
  {
    name: "muggle-remote-report-final-generate",
    description: "Generate a final test report for a project.",
    inputSchema: schemas.ReportFinalGenerateInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ReportFinalGenerateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/report/final/generate`,
        body: {
          projectId: data.projectId,
          exportFormat: data.exportFormat,
        },
        timeoutMs: getWorkflowTimeoutMs(),
      };
    },
  },
];

// =============================================================================
// Secret Tools
// =============================================================================

const secretTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-secret-list",
    description: "List all secrets for a project. Secret values are not returned for security.",
    inputSchema: schemas.SecretListInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.SecretListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/secrets`,
        queryParams: { projectId: data.projectId },
      };
    },
  },
  {
    name: "muggle-remote-secret-create",
    description: "Create a new secret (credential) for a project.",
    inputSchema: schemas.SecretCreateInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.SecretCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/secrets`,
        body: {
          projectId: data.projectId,
          secretName: data.name,
          value: data.value,
          description: data.description,
          source: data.source,
        },
      };
    },
  },
  {
    name: "muggle-remote-secret-get",
    description: "Get details of a specific secret. The secret value is not returned for security.",
    inputSchema: schemas.SecretGetInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.SecretGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/secrets/${data.secretId}`,
      };
    },
  },
  {
    name: "muggle-remote-secret-update",
    description: "Update an existing secret.",
    inputSchema: schemas.SecretUpdateInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.SecretUpdateInputSchema>;
      const body: Record<string, unknown> = {};
      if (data.name !== undefined) body.name = data.name;
      if (data.value !== undefined) body.value = data.value;
      if (data.description !== undefined) body.description = data.description;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/secrets/${data.secretId}`,
        body: body,
      };
    },
  },
  {
    name: "muggle-remote-secret-delete",
    description: "Delete a secret from a project.",
    inputSchema: schemas.SecretDeleteInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.SecretDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/secrets/${data.secretId}`,
      };
    },
  },
];

// =============================================================================
// PRD File Tools
// =============================================================================

const prdFileTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-prd-file-upload",
    description: "Upload a PRD file to a project. File content should be base64-encoded.",
    inputSchema: schemas.PrdFileUploadInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.PrdFileUploadInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/prd-file-upload`,
        multipartFormData: {
          fileFieldName: "file",
          fileName: data.fileName,
          contentType: data.contentType || "application/octet-stream",
          fileBase64: data.contentBase64,
        },
      };
    },
  },
  {
    name: "muggle-remote-prd-file-list-by-project",
    description: "List all PRD files associated with a project.",
    inputSchema: schemas.PrdFileListInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.PrdFileListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/prd-files`,
      };
    },
  },
  {
    name: "muggle-remote-prd-file-delete",
    description: "Delete a PRD file from a project.",
    inputSchema: schemas.PrdFileDeleteInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.PrdFileDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/projects/${data.projectId}/prd-files/${data.prdFileId}`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-prd-file-process",
    description: "Start a PRD file processing workflow to extract use cases.",
    inputSchema: schemas.PrdFileProcessStartInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.PrdFileProcessStartInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/prd-file-process`,
        body: {
          projectId: data.projectId,
          name: data.name,
          description: data.description,
          prdFilePath: data.prdFilePath,
          originalFileName: data.originalFileName,
          url: data.url,
          contentChecksum: data.contentChecksum,
          fileSize: data.fileSize,
        },
      };
    },
  },
  {
    name: "muggle-remote-wf-get-prd-process-latest-run",
    description: "Get the latest run status of a PRD file processing workflow.",
    inputSchema: schemas.PrdFileProcessLatestRunInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.PrdFileProcessLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/prd-file-process/${data.workflowRuntimeId}/run/latest`,
      };
    },
  },
];

// =============================================================================
// Wallet Tools
// =============================================================================

const walletTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-wallet-topup",
    description: "Create a Stripe checkout session to purchase a token package.",
    inputSchema: schemas.WalletTopUpInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WalletTopUpInputSchema>;
      return {
        method: "POST",
        path: "/v1/protected/wallet/topup",
        body: {
          packageId: data.packageId,
          checkoutSuccessCallback: data.checkoutSuccessCallback,
          checkoutCancelCallback: data.checkoutCancelCallback,
        },
      };
    },
  },
  {
    name: "muggle-remote-wallet-pm-create-setup-session",
    description: "Create a Stripe setup session to add a payment method.",
    inputSchema: schemas.WalletPaymentMethodCreateSetupSessionInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WalletPaymentMethodCreateSetupSessionInputSchema>;
      return {
        method: "POST",
        path: "/v1/protected/wallet/payment-methods/setup",
        body: {
          checkoutSuccessCallback: data.checkoutSuccessCallback,
          checkoutCancelCallback: data.checkoutCancelCallback,
        },
      };
    },
  },
  {
    name: "muggle-remote-wallet-auto-topup-set-payment-method",
    description: "Set the saved payment method used by wallet auto top-up.",
    inputSchema: schemas.WalletAutoTopUpSetPaymentMethodInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WalletAutoTopUpSetPaymentMethodInputSchema>;
      return {
        method: "PUT",
        path: "/v1/protected/wallet/auto-topup/payment-method",
        body: { paymentMethodId: data.paymentMethodId },
      };
    },
  },
  {
    name: "muggle-remote-wallet-payment-method-list",
    description: "List saved payment methods.",
    inputSchema: schemas.WalletPaymentMethodListInputSchema,
    mapToUpstream: () => {
      return {
        method: "GET",
        path: "/v1/protected/wallet/payment-methods",
      };
    },
  },
  {
    name: "muggle-remote-wallet-auto-topup-update",
    description: "Update wallet auto-topup settings.",
    inputSchema: schemas.WalletAutoTopUpUpdateInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.WalletAutoTopUpUpdateInputSchema>;
      return {
        method: "PUT",
        path: "/v1/protected/wallet/auto-topup",
        body: {
          enabled: data.enabled,
          topUpTriggerTokenThreshold: data.topUpTriggerTokenThreshold,
          packageId: data.packageId,
        },
      };
    },
  },
];

// =============================================================================
// Recommendation Tools (No upstream calls)
// =============================================================================

const recommendationTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-recommend-schedule",
    description: "Get recommendations for test scheduling based on project needs.",
    inputSchema: schemas.RecommendScheduleInputSchema,
    requiresAuth: false,
    mapToUpstream: () => {
      throw new Error("RECOMMENDATION_ONLY");
    },
    mapFromUpstream: () => {
      return {
        recommendations: [
          {
            title: "Nightly Regression Tests",
            rationale: "Running tests every night catches regressions quickly.",
            schedule: "0 2 * * *",
            timezone: "UTC",
          },
          {
            title: "On-Demand with Smoke Tests",
            rationale: "Run smoke tests on every PR, full regression on merge.",
            schedule: "Pull Request trigger + main branch merge",
          },
          {
            title: "Continuous Monitoring",
            rationale: "Run tests every 4 hours for production monitoring.",
            schedule: "0 */4 * * *",
          },
        ],
      };
    },
    localHandler: async () => {
      return {
        recommendations: [
          {
            title: "Nightly Regression Tests",
            rationale: "Running tests every night catches regressions quickly.",
            schedule: "0 2 * * *",
            timezone: "UTC",
          },
          {
            title: "On-Demand with Smoke Tests",
            rationale: "Run smoke tests on every PR, full regression on merge.",
            schedule: "Pull Request trigger + main branch merge",
          },
          {
            title: "Continuous Monitoring",
            rationale: "Run tests every 4 hours for production monitoring.",
            schedule: "0 */4 * * *",
          },
        ],
      };
    },
  },
  {
    name: "muggle-remote-recommend-cicd-setup",
    description: "Get recommendations and templates for CI/CD integration.",
    inputSchema: schemas.RecommendCicdSetupInputSchema,
    requiresAuth: false,
    mapToUpstream: () => {
      throw new Error("RECOMMENDATION_ONLY");
    },
    localHandler: async (input) => {
      const data = input as z.infer<typeof schemas.RecommendCicdSetupInputSchema>;
      const provider = data?.repositoryProvider || "github";

      const recommendations = [];

      if (provider === "github" || provider === "other") {
        recommendations.push({
          title: "GitHub Actions Integration",
          rationale: "Native GitHub integration with minimal setup.",
          steps: [
            "Create .github/workflows/muggle-test.yml",
            "Add MUGGLE_AI_API_KEY as a repository secret",
            "Configure workflow trigger",
          ],
        });
      }

      if (provider === "azureDevOps" || provider === "other") {
        recommendations.push({
          title: "Azure DevOps Pipelines Integration",
          rationale: "Native Azure DevOps integration with pipeline triggers.",
          steps: [
            "Create azure-pipelines.yml",
            "Add MUGGLE_AI_API_KEY to variable group",
            "Configure triggers",
          ],
        });
      }

      if (provider === "gitlab" || provider === "other") {
        recommendations.push({
          title: "GitLab CI Integration",
          rationale: "Native GitLab CI integration with merge request pipelines.",
          steps: [
            "Add .gitlab-ci.yml",
            "Add MUGGLE_AI_API_KEY as CI/CD variable",
            "Configure pipeline rules",
          ],
        });
      }

      return { recommendations: recommendations };
    },
  },
];

// =============================================================================
// API Key Tools
// =============================================================================

/** API key endpoint prefix. */
const API_KEY_PREFIX = "/v1/protected/api-keys";

const apiKeyTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-auth-api-key-create",
    description: "Create a new API key for the authenticated user. Requires existing authentication.",
    inputSchema: schemas.ApiKeyCreateInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ApiKeyCreateInputSchema>;
      return {
        method: "POST",
        path: API_KEY_PREFIX,
        body: {
          name: data.name || "MCP Gateway Key",
          expiry: data.expiry || "90d",
        },
      };
    },
    mapFromUpstream: (response) => {
      const data = response.data as {
        id: string;
        key: string;
        name: string | null;
        status: string;
        prefix: string;
        lastFour: string;
        createdAt: number;
        expiresAt: number | null;
      };

      const maskedKey = `${data.prefix}...${data.lastFour}`;
      const expiresAt = data.expiresAt
        ? new Date(data.expiresAt).toISOString()
        : "never";

      return {
        success: true,
        message: "API key created.",
        apiKey: {
          id: data.id,
          key: data.key,
          hint: maskedKey,
          name: data.name,
          status: data.status,
          createdAt: new Date(data.createdAt).toISOString(),
          expiresAt: expiresAt,
        },
        note: "The full API key is returned only once. Store it securely.",
      };
    },
  },
  {
    name: "muggle-remote-auth-api-key-list",
    description: "List all API keys for the authenticated user. Shows key metadata but not the secret values.",
    inputSchema: schemas.ApiKeyListInputSchema,
    mapToUpstream: () => {
      return {
        method: "GET",
        path: API_KEY_PREFIX,
      };
    },
    mapFromUpstream: (response) => {
      const keys = response.data as Array<{
        id: string;
        name: string | null;
        status: string;
        prefix: string;
        lastFour: string;
        createdAt: number;
        expiresAt: number | null;
        revokedAt: number | null;
      }>;

      return {
        success: true,
        count: keys.length,
        apiKeys: keys.map((key) => ({
          id: key.id,
          name: key.name,
          status: key.status,
          hint: `${key.prefix}...${key.lastFour}`,
          createdAt: new Date(key.createdAt).toISOString(),
          expiresAt: key.expiresAt ? new Date(key.expiresAt).toISOString() : "never",
          revokedAt: key.revokedAt ? new Date(key.revokedAt).toISOString() : null,
        })),
      };
    },
  },
  {
    name: "muggle-remote-auth-api-key-get",
    description: "Get details of a specific API key by ID.",
    inputSchema: schemas.ApiKeyGetInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ApiKeyGetInputSchema>;
      return {
        method: "GET",
        path: `${API_KEY_PREFIX}/${data.apiKeyId}`,
      };
    },
    mapFromUpstream: (response) => {
      const key = response.data as {
        id: string;
        name: string | null;
        status: string;
        prefix: string;
        lastFour: string;
        createdAt: number;
        expiresAt: number | null;
        revokedAt: number | null;
      };

      return {
        success: true,
        apiKey: {
          id: key.id,
          name: key.name,
          status: key.status,
          hint: `${key.prefix}...${key.lastFour}`,
          createdAt: new Date(key.createdAt).toISOString(),
          expiresAt: key.expiresAt ? new Date(key.expiresAt).toISOString() : "never",
          revokedAt: key.revokedAt ? new Date(key.revokedAt).toISOString() : null,
        },
      };
    },
  },
  {
    name: "muggle-remote-auth-api-key-revoke",
    description: "Revoke an API key. The key will immediately stop working. Use qa_auth_api_key_list to find the key ID first.",
    inputSchema: schemas.ApiKeyRevokeInputSchema,
    mapToUpstream: (input) => {
      const data = input as z.infer<typeof schemas.ApiKeyRevokeInputSchema>;
      return {
        method: "DELETE",
        path: `${API_KEY_PREFIX}/${data.apiKeyId}`,
      };
    },
    mapFromUpstream: () => {
      return {
        success: true,
        message: "API key revoked successfully. It will no longer work for authentication.",
      };
    },
  },
];

// =============================================================================
// Auth Tools (Device Code Flow)
// =============================================================================

const authTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-auth-status",
    description: "Check current authentication status. Shows if you're logged in and when your session expires.",
    inputSchema: schemas.EmptyInputSchema,
    requiresAuth: false,
    mapToUpstream: () => {
      throw new Error("LOCAL_HANDLER_ONLY");
    },
    localHandler: async () => {
      const authService = getAuthService();
      const status = authService.getAuthStatus();

      if (!status.authenticated) {
        return {
          authenticated: false,
          message: "Not authenticated. Use muggle-remote-auth-login to authenticate.",
        };
      }

      return {
        authenticated: true,
        email: status.email,
        userId: status.userId,
        expiresAt: status.expiresAt,
        isExpired: status.isExpired,
      };
    },
  },
  {
    name: "muggle-remote-auth-login",
    description: "Start authentication with the Muggle Test service. Opens a browser-based login flow and waits for confirmation by default. If login is still pending after the wait timeout, use muggle-remote-auth-poll to finish authentication.",
    inputSchema: schemas.AuthLoginInputSchema,
    requiresAuth: false,
    mapToUpstream: () => {
      throw new Error("LOCAL_HANDLER_ONLY");
    },
    localHandler: async (input) => {
      const data = input as z.infer<typeof schemas.AuthLoginInputSchema>;
      const authService = getAuthService();

      const deviceCodeResponse = await authService.startDeviceCodeFlow();
      const waitForCompletion = data.waitForCompletion ?? true;

      if (!waitForCompletion) {
        return {
          status: "pending",
          deviceCode: deviceCodeResponse.deviceCode,
          userCode: deviceCodeResponse.userCode,
          verificationUri: deviceCodeResponse.verificationUri,
          browserOpened: deviceCodeResponse.browserOpened,
          message: "Login started. Complete authentication in your browser, then call muggle-remote-auth-poll.",
        };
      }

      const pollResult = await authService.waitForDeviceCodeAuthorization({
        deviceCode: deviceCodeResponse.deviceCode,
        intervalSeconds: deviceCodeResponse.interval,
        timeoutMs: data.timeoutMs,
      });

      if (pollResult.status === DeviceCodePollStatus.Complete) {
        return {
          status: "complete",
          success: true,
          email: pollResult.email,
          message: "Login successful. You are now authenticated.",
        };
      }

      return {
        status: pollResult.status,
        message: pollResult.message,
      };
    },
  },
  {
    name: "muggle-remote-auth-poll",
    description: "Poll for login completion after starting the login flow with muggle-remote-auth-login. Call this after the user completes authentication in their browser.",
    inputSchema: schemas.AuthPollInputSchema,
    requiresAuth: false,
    mapToUpstream: () => {
      throw new Error("LOCAL_HANDLER_ONLY");
    },
    localHandler: async (input) => {
      const data = input as z.infer<typeof schemas.AuthPollInputSchema>;
      const authService = getAuthService();

      const deviceCode = data.deviceCode ?? authService.getPendingDeviceCode();

      if (!deviceCode) {
        return {
          error: "NO_PENDING_LOGIN",
          message: "No pending login found. Please start a new login with muggle-remote-auth-login.",
        };
      }

      const result = await authService.pollDeviceCode(deviceCode);

      if (result.status === DeviceCodePollStatus.Complete) {
        return {
          status: "complete",
          success: true,
          email: result.email,
          message: "Login complete. You are now authenticated.",
        };
      }

      return {
        status: result.status,
        message: result.message,
      };
    },
  },
  {
    name: "muggle-remote-auth-logout",
    description: "Log out and clear stored credentials.",
    inputSchema: schemas.EmptyInputSchema,
    requiresAuth: false,
    mapToUpstream: () => {
      throw new Error("LOCAL_HANDLER_ONLY");
    },
    localHandler: async () => {
      const authService = getAuthService();
      const result = authService.logout();

      if (result) {
        return { success: true, message: "Successfully logged out." };
      }

      return { success: false, message: "No active session to log out from." };
    },
  },
];

// =============================================================================
// All Tools Combined
// =============================================================================

/** All QA tool definitions. */
export const allQaToolDefinitions: IQaToolDefinition[] = [
  ...projectTools,
  ...useCaseTools,
  ...testCaseTools,
  ...testScriptTools,
  ...workflowTools,
  ...reportTools,
  ...secretTools,
  ...prdFileTools,
  ...walletTools,
  ...recommendationTools,
  ...apiKeyTools,
  ...authTools,
];

/**
 * Get a QA tool definition by name.
 * @param name - Tool name.
 * @returns Tool definition or undefined.
 */
export function getQaToolByName(name: string): IQaToolDefinition | undefined {
  return allQaToolDefinitions.find((tool) => tool.name === name);
}

/**
 * Default response mapper.
 * @param response - Upstream response.
 * @returns Response data.
 */
function defaultResponseMapper(response: IUpstreamResponse): unknown {
  return response.data;
}

/**
 * Execute a QA tool.
 * @param toolName - Tool name.
 * @param input - Tool input.
 * @param correlationId - Correlation ID.
 * @returns Tool result.
 */
export async function executeQaTool(
  toolName: string,
  input: unknown,
  correlationId: string,
): Promise<IMcpToolResult> {
  const logger = createChildLogger(correlationId);
  const tool = getQaToolByName(toolName);

  if (!tool) {
    return {
      content: JSON.stringify({ error: "NOT_FOUND", message: `Unknown tool: ${toolName}` }),
      isError: true,
    };
  }

  try {
    // Validate input
    const validatedInput = tool.inputSchema.parse(input);

    // Check if tool has a local handler
    if (tool.localHandler) {
      const result = await tool.localHandler(validatedInput);
      return {
        content: JSON.stringify(result, null, 2),
        isError: false,
      };
    }

    // Get credentials (async with auto-refresh)
    const credentials = await getCallerCredentialsAsync();

    // Execute upstream call
    try {
      const upstreamCall = tool.mapToUpstream(validatedInput);
      const client = getPromptServiceClient();
      const response = await client.execute(upstreamCall, credentials, correlationId);

      // Map response
      const mapper = tool.mapFromUpstream || defaultResponseMapper;
      const result = mapper(response, validatedInput);

      return {
        content: JSON.stringify(result, null, 2),
        isError: false,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "RECOMMENDATION_ONLY") {
        // This is a recommendation tool, return static response
        const mapper = tool.mapFromUpstream || defaultResponseMapper;
        const result = mapper({ statusCode: 200, data: {}, headers: {} }, validatedInput);
        return {
          content: JSON.stringify(result, null, 2),
          isError: false,
        };
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof GatewayError) {
      logger.warn("Tool call failed with gateway error", {
        tool: toolName,
        code: error.code,
        message: error.message,
      });
      return {
        content: JSON.stringify({ error: error.code, message: error.message }),
        isError: true,
      };
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Tool call failed", { tool: toolName, error: errorMessage });
    return {
      content: JSON.stringify({ error: "INTERNAL_ERROR", message: errorMessage }),
      isError: true,
    };
  }
}
