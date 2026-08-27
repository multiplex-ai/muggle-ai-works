/**
 * Cloud E2E tool registry (muggle-remote-* prefix) — maps tool names to their implementations.
 */

import { z } from "zod";

import { getCallerCredentialsAsync } from "../../../shared/auth.js";
import { getConfig } from "../../../shared/config.js";
import { createChildLogger } from "../../../shared/logger.js";
import { EventName, Outcome, ToolSurface, track } from "@muggleai/telemetry";
import type { IMcpToolResult } from "../../../shared/types.js";

import * as schemas from "../../e2e/contracts/index.js";
import { GatewayError, IQaToolDefinition, IUpstreamResponse } from "../../e2e/types.js";
import { getPromptServiceClient } from "../../e2e/upstream-client.js";
import { getAuthService } from "../../local/services/index.js";
import { DeviceCodePollStatus } from "../../local/types/index.js";
import { mapTestRunsSummary } from "./test-runs-summary-transform.js";
import { mapTestScriptsSummary } from "./test-scripts-summary-transform.js";

/** Muggle Test API prefix. */
const MUGGLE_TEST_PREFIX = "/v1/protected/muggle-test";

/** Default workflow timeout. */
const getWorkflowTimeoutMs = (): number => getConfig().e2e.workflowTimeoutMs;

const projectTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-project-create",
    description: "Create an E2E acceptance testing project to organize browser tests for a web app. A project groups test scenarios (use cases), specific test steps (test cases), and replayable browser scripts (test scripts) for one application. Create a project first before generating or running any E2E tests.",
    inputSchema: schemas.ProjectCreateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ProjectCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects`,
        body: {
          name: toolInput.projectName,
          description: toolInput.description,
          url: toolInput.url,
        },
      };
    },
  },
  {
    name: "muggle-remote-project-get",
    description: "Get details of a specific project by ID.",
    inputSchema: schemas.ProjectGetInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ProjectGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}`,
      };
    },
  },
  {
    name: "muggle-remote-project-update",
    description: "Update an existing project's details.",
    inputSchema: schemas.ProjectUpdateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ProjectUpdateInputSchema>;
      const body: Record<string, unknown> = { id: toolInput.projectId };
      if (toolInput.projectName !== undefined) body.name = toolInput.projectName;
      if (toolInput.description !== undefined) body.description = toolInput.description;
      if (toolInput.url !== undefined) body.url = toolInput.url;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}`,
        body: body,
      };
    },
  },
  {
    name: "muggle-remote-project-list",
    description:
      "List projects accessible to the authenticated user. Returns up to 10 items per page by default (max 100). Response includes pagination metadata (totalCount, totalPages, hasMore) — check `hasMore` to decide whether to fetch additional pages.",
    inputSchema: schemas.ProjectListInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ProjectListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects`,
        queryParams: {
          page: toolInput.page,
          pageSize: toolInput.pageSize,
          sortBy: toolInput.sortBy,
          sortOrder: toolInput.sortOrder,
        },
      };
    },
  },
  {
    name: "muggle-remote-project-delete",
    description: "Delete a project and all associated entities. This is a soft delete.",
    inputSchema: schemas.ProjectDeleteInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ProjectDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}`,
      };
    },
  },
];

const useCaseTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-use-case-discovery-memory-get",
    description: "Get the use case discovery memory for a project, including all discovered use case candidates.",
    inputSchema: schemas.UseCaseDiscoveryMemoryGetInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UseCaseDiscoveryMemoryGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/use-case-discovery-memory`,
      };
    },
  },
  {
    name: "muggle-remote-use-case-candidates-approve",
    description: "Approve (graduate) selected use case candidates into actual use cases.",
    inputSchema: schemas.UseCaseCandidatesApproveInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UseCaseCandidatesApproveInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/use-case-discovery-memory/graduate`,
        body: { approveIds: toolInput.approvedCandidateIds },
      };
    },
  },
  {
    name: "muggle-remote-use-case-list",
    description:
      "List use cases for a project. Returns up to 10 items per page by default (max 100). Response includes pagination metadata (totalCount, totalPages, hasMore) — check `hasMore` to decide whether to fetch additional pages.",
    inputSchema: schemas.UseCaseListInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UseCaseListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/use-cases`,
        queryParams: {
          projectId: toolInput.projectId,
          page: toolInput.page,
          pageSize: toolInput.pageSize,
          sortBy: toolInput.sortBy,
          sortOrder: toolInput.sortOrder,
        },
      };
    },
  },
  {
    name: "muggle-remote-use-case-get",
    description: "Get details of a specific use case by ID.",
    inputSchema: schemas.UseCaseGetInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UseCaseGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/use-cases/${toolInput.useCaseId}`,
      };
    },
  },
  {
    name: "muggle-remote-use-case-prompt-preview",
    description: "Preview a use case generated from a natural language instruction without saving.",
    inputSchema: schemas.UseCasePromptPreviewInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UseCasePromptPreviewInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/use-cases/prompt/preview`,
        body: { instruction: toolInput.instruction },
      };
    },
  },
  {
    name: "muggle-remote-use-case-create-from-prompts",
    description: "Create one or more use cases from natural language instructions.",
    inputSchema: schemas.UseCaseCreateFromPromptsInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UseCaseCreateFromPromptsInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/use-cases/prompts/bulk`,
        body: {
          projectId: toolInput.projectId,
          prompts: toolInput.instructions.map((instruction) => ({ instruction })),
        },
      };
    },
  },
  {
    name: "muggle-remote-use-case-update-from-prompt",
    description: "Update an existing use case by regenerating its fields from a new instruction.",
    inputSchema: schemas.UseCaseUpdateFromPromptInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UseCaseUpdateFromPromptInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/use-cases/${toolInput.useCaseId}/prompt`,
        body: { instruction: toolInput.instruction },
      };
    },
  },
  {
    name: "muggle-remote-use-case-update",
    description: "Directly update an existing use case's fields without invoking the LLM. Pass only the fields you want to change — others are left untouched. Use this for cheap, deterministic edits (rename, flip status DRAFT→APPROVED, change priority, edit acceptance criteria). For LLM regeneration from a new instruction, use muggle-remote-use-case-update-from-prompt instead. Note: changing title, description, or url triggers background regeneration of dependent test cases on the server.",
    inputSchema: schemas.UseCaseUpdateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UseCaseUpdateInputSchema>;
      const body: Record<string, unknown> = { id: toolInput.useCaseId };
      if (toolInput.title !== undefined) body.title = toolInput.title;
      if (toolInput.description !== undefined) body.description = toolInput.description;
      if (toolInput.userStory !== undefined) body.userStory = toolInput.userStory;
      if (toolInput.url !== undefined) body.url = toolInput.url;
      if (toolInput.useCaseBreakdown !== undefined) body.useCaseBreakdown = toolInput.useCaseBreakdown;
      if (toolInput.status !== undefined) body.status = toolInput.status;
      if (toolInput.priority !== undefined) body.priority = toolInput.priority;
      if (toolInput.source !== undefined) body.source = toolInput.source;
      if (toolInput.category !== undefined) body.category = toolInput.category;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/use-cases/${toolInput.useCaseId}`,
        body: body,
      };
    },
  },
  {
    name: "muggle-remote-use-case-create",
    description: "Create a single use case from a fully-specified payload. Use this to persist use cases returned by muggle-remote-use-case-bulk-preview-submit — no LLM is invoked.",
    inputSchema: schemas.UseCaseCreateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UseCaseCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/use-cases`,
        body: {
          projectId: toolInput.projectId,
          title: toolInput.title,
          description: toolInput.description,
          userStory: toolInput.userStory,
          url: toolInput.url,
          useCaseBreakdown: toolInput.useCaseBreakdown,
          status: toolInput.status,
          priority: toolInput.priority,
          source: toolInput.source,
          category: toolInput.category,
        },
      };
    },
  },
  {
    name: "muggle-remote-use-case-bulk-preview-submit",
    description: "Submit an async bulk-preview job that uses the OpenAI Batch API to generate use cases from many prompts at ~50% of normal LLM cost. Returns a job ID immediately; poll with muggle-remote-bulk-preview-job-get until the job reaches a terminal status, then persist each successful result via muggle-remote-use-case-create.",
    inputSchema: schemas.BulkPreviewSubmitUseCaseInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.BulkPreviewSubmitUseCaseInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/use-cases/prompts/bulk-preview`,
        body: { prompts: toolInput.prompts },
      };
    },
  },
  {
    name: "muggle-remote-use-case-delete",
    description: "Delete a use case by ID. Soft delete, and it cascades: the use case's test cases and their test scripts are deleted with it.",
    inputSchema: schemas.UseCaseDeleteInputSchema,
    mapToUpstream: (input) => {
      const useCaseDeleteInput = input as z.infer<typeof schemas.UseCaseDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/use-cases/${useCaseDeleteInput.useCaseId}`,
      };
    },
  },
];

const testCaseTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-test-case-list",
    description:
      "List test cases for a project. Returns up to 10 items per page by default (max 100). Response includes pagination metadata (totalCount, totalPages, hasMore) — check `hasMore` to decide whether to fetch additional pages.",
    inputSchema: schemas.TestCaseListInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.TestCaseListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-cases`,
        queryParams: {
          projectId: toolInput.projectId,
          page: toolInput.page,
          pageSize: toolInput.pageSize,
          sortBy: toolInput.sortBy,
          sortOrder: toolInput.sortOrder,
        },
      };
    },
  },
  {
    name: "muggle-remote-test-case-get",
    description: "Get details of a specific test case.",
    inputSchema: schemas.TestCaseGetInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.TestCaseGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-cases/${toolInput.testCaseId}`,
      };
    },
  },
  {
    name: "muggle-remote-test-case-ancestors-get",
    description:
      "Resolve a test case's prerequisite chain from the project's test-plan graph. Returns { testCaseId, ancestors, orphan } where `ancestors` is an array of test case IDs ordered immediate-parent → root (empty when the case is a graph root). `orphan: true` means the case has no graph node, so it has no prerequisites. Call this before generating or replaying a script to ensure every prerequisite test case already has a ready script.",
    inputSchema: schemas.TestCaseAncestorsGetInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.TestCaseAncestorsGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-plan-graph/test-cases/${toolInput.testCaseId}/ancestors`,
      };
    },
  },
  {
    name: "muggle-remote-test-case-list-by-use-case",
    description: "List test cases for a specific use case.",
    inputSchema: schemas.TestCaseListByUseCaseInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.TestCaseListByUseCaseInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/use-cases/${toolInput.useCaseId}/test-cases`,
      };
    },
  },
  {
    name: "muggle-remote-test-case-generate-from-prompt",
    description: "Generate E2E acceptance test cases from a plain-English description of what to test — e.g., 'test the signup flow with invalid email' or 'verify the checkout handles empty cart'. Returns preview test cases that can be used to generate executable browser test scripts.",
    inputSchema: schemas.TestCaseGenerateFromPromptInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.TestCaseGenerateFromPromptInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/use-cases/${toolInput.useCaseId}/test-cases/prompt/preview`,
        body: { instruction: toolInput.instruction },
      };
    },
  },
  {
    name: "muggle-remote-test-case-create",
    description: "Create a new test case for a use case.",
    inputSchema: schemas.TestCaseCreateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.TestCaseCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/test-cases`,
        body: {
          projectId: toolInput.projectId,
          useCaseId: toolInput.useCaseId,
          title: toolInput.title,
          description: toolInput.description,
          goal: toolInput.goal,
          precondition: toolInput.precondition,
          expectedResult: toolInput.expectedResult,
          url: toolInput.url,
          status: toolInput.status || "DRAFT",
          priority: toolInput.priority || "MEDIUM",
          tags: toolInput.tags || [],
          category: toolInput.category || "Functional",
          automated: toolInput.automated ?? true,
        },
      };
    },
  },
  {
    name: "muggle-remote-test-case-update",
    description: "Directly update an existing test case's fields. Pass only the fields you want to change — others are left untouched. Use this for cheap, deterministic edits (rename, change status/priority, fix expected result, add tags). Does not touch the associated test script — script regeneration is a separate workflow (muggle-remote-workflow-start-test-script-generation).",
    inputSchema: schemas.TestCaseUpdateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.TestCaseUpdateInputSchema>;
      const body: Record<string, unknown> = { id: toolInput.testCaseId };
      if (toolInput.title !== undefined) body.title = toolInput.title;
      if (toolInput.description !== undefined) body.description = toolInput.description;
      if (toolInput.goal !== undefined) body.goal = toolInput.goal;
      if (toolInput.precondition !== undefined) body.precondition = toolInput.precondition;
      if (toolInput.expectedResult !== undefined) body.expectedResult = toolInput.expectedResult;
      if (toolInput.url !== undefined) body.url = toolInput.url;
      if (toolInput.status !== undefined) body.status = toolInput.status;
      if (toolInput.priority !== undefined) body.priority = toolInput.priority;
      if (toolInput.tags !== undefined) body.tags = toolInput.tags;
      if (toolInput.category !== undefined) body.category = toolInput.category;
      if (toolInput.automated !== undefined) body.automated = toolInput.automated;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/test-cases/${toolInput.testCaseId}`,
        body: body,
      };
    },
  },
  {
    name: "muggle-remote-test-case-bulk-preview-submit",
    description: "Submit an async bulk-preview job that uses the OpenAI Batch API to generate test cases for a single use case from many prompts at ~50% of normal LLM cost. Returns a job ID immediately; poll with muggle-remote-bulk-preview-job-get until the job reaches a terminal status, then persist each successful result via muggle-remote-test-case-create. Note: one input prompt may fan out to 1–5 test cases.",
    inputSchema: schemas.BulkPreviewSubmitTestCaseInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.BulkPreviewSubmitTestCaseInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/use-cases/${toolInput.useCaseId}/test-cases/prompts/bulk-preview`,
        body: { prompts: toolInput.prompts },
      };
    },
  },
  {
    name: "muggle-remote-test-case-delete",
    description: "Delete a test case by ID. This is a soft delete.",
    inputSchema: schemas.TestCaseDeleteInputSchema,
    mapToUpstream: (input) => {
      const testCaseDeleteInput = input as z.infer<typeof schemas.TestCaseDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/test-cases/${testCaseDeleteInput.testCaseId}`,
      };
    },
  },
];

const bulkPreviewTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-bulk-preview-job-get",
    description: "Get the current status and (when terminal) results of a bulk-preview job. Poll this after submitting a bulk-preview job — every 10–15 seconds is fine. Terminal statuses: succeeded, partial, failed, cancelled, expired.",
    inputSchema: schemas.BulkPreviewJobGetInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.BulkPreviewJobGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/bulk-preview-jobs/${toolInput.jobId}`,
      };
    },
  },
  {
    name: "muggle-remote-bulk-preview-job-list",
    description: "List bulk-preview jobs for a project, optionally filtered by status or kind.",
    inputSchema: schemas.BulkPreviewJobListInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.BulkPreviewJobListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/bulk-preview-jobs`,
        queryParams: {
          status: toolInput.status?.join(","),
          kind: toolInput.kind,
          limit: toolInput.limit,
          cursor: toolInput.cursor,
        },
      };
    },
  },
  {
    name: "muggle-remote-bulk-preview-job-cancel",
    description: "Request cancellation of a bulk-preview job. Cancellation is cooperative — the harvester picks it up on its next tick and moves the job to status=cancelled.",
    inputSchema: schemas.BulkPreviewJobCancelInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.BulkPreviewJobCancelInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/bulk-preview-jobs/${toolInput.jobId}`,
      };
    },
  },
];

const testScriptTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-test-script-list",
    description:
      "List test scripts for a project, optionally filtered by test case and by environment lane. Returns up to 10 items per page by default (max 100). Response includes pagination metadata (totalCount, totalPages, hasMore) — check `hasMore` to decide whether to fetch additional pages.",
    inputSchema: schemas.TestScriptListInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.TestScriptListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-scripts`,
        queryParams: {
          projectId: toolInput.projectId,
          testCaseId: toolInput.testCaseId,
          runEnvironmentType: toolInput.runEnvironmentType,
          page: toolInput.page,
          pageSize: toolInput.pageSize,
          sortBy: toolInput.sortBy,
          sortOrder: toolInput.sortOrder,
        },
      };
    },
  },
  {
    name: "muggle-remote-test-script-get",
    description: "Get details of a specific test script.",
    inputSchema: schemas.TestScriptGetInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.TestScriptGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-scripts/${toolInput.testScriptId}`,
      };
    },
  },
  {
    name: "muggle-remote-test-script-delete",
    description: "Delete a test script by ID. This is a soft delete; the test case it belongs to is not affected.",
    inputSchema: schemas.TestScriptDeleteInputSchema,
    mapToUpstream: (input) => {
      const testScriptDeleteInput = input as z.infer<typeof schemas.TestScriptDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/test-scripts/${testScriptDeleteInput.testScriptId}`,
      };
    },
  },
];

const actionScriptTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-action-script-get",
    description: "Get the full action script content by ID. Use actionScriptId from a test script to fetch the complete script with all steps and element labels needed for replay.",
    inputSchema: schemas.ActionScriptGetInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ActionScriptGetInputSchema>;
      return {
        method: "GET",
        path: `/v1/protected/actionScript/${toolInput.actionScriptId}`,
      };
    },
  },
  {
    name: "muggle-remote-action-script-delete",
    description: "Permanently delete an action script by ID. Unlike the other delete tools this is a hard delete and cannot be undone, and any test script referencing it keeps an orphaned actionScriptId. Only the owner or a super user may call it.",
    inputSchema: schemas.ActionScriptDeleteInputSchema,
    mapToUpstream: (input) => {
      const actionScriptDeleteInput = input as z.infer<typeof schemas.ActionScriptDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `/v1/protected/actionScript/${actionScriptDeleteInput.actionScriptId}`,
      };
    },
  },
];

const workflowTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-workflow-start-website-scan",
    description: "Scan a website to automatically discover testable user flows and UI interactions. Crawls the site and identifies use cases like signup, login, search, checkout, form submissions, and navigation patterns. Use this when setting up E2E acceptance testing for a site without predefined test cases.",
    inputSchema: schemas.WorkflowStartWebsiteScanInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowStartWebsiteScanInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/website-scan`,
        body: {
          projectId: toolInput.projectId,
          url: toolInput.url,
          description: toolInput.description,
          archiveUnapproved: toolInput.archiveUnapproved,
          ...(toolInput.workflowParams && { workflowParams: toolInput.workflowParams }),
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
      const toolInput = input as z.infer<typeof schemas.WorkflowListRuntimesInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/website-scan/workflowRuntimes`,
        queryParams: { projectId: toolInput.projectId },
      };
    },
  },
  {
    name: "muggle-remote-workflow-get-website-scan-latest-run",
    description: "Get the latest run status for a website scan workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/website-scan/${toolInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-case-detection",
    description: "Start a test case detection workflow to generate test cases from use cases.",
    inputSchema: schemas.WorkflowStartTestCaseDetectionInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowStartTestCaseDetectionInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-case/test-case-detection`,
        body: {
          projectId: toolInput.projectId,
          useCaseId: toolInput.useCaseId,
          name: toolInput.name,
          description: toolInput.description,
          url: toolInput.url,
          ...(toolInput.workflowParams && { workflowParams: toolInput.workflowParams }),
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
      const toolInput = input as z.infer<typeof schemas.WorkflowListRuntimesInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-case/test-case-detection/workflowRuntimes`,
        queryParams: { projectId: toolInput.projectId },
      };
    },
  },
  {
    name: "muggle-remote-wf-get-tc-detect-latest-run",
    description: "Get the latest run status for a test case detection workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-case/test-case-detection/${toolInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-script-generation",
    description: "Start a test script generation workflow.",
    inputSchema: schemas.WorkflowStartTestScriptGenerationInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowStartTestScriptGenerationInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation`,
        body: {
          projectId: toolInput.projectId,
          testCaseId: toolInput.testCaseId,
          useCaseId: toolInput.useCaseId,
          name: toolInput.name,
          url: toolInput.url,
          goal: toolInput.goal,
          precondition: toolInput.precondition,
          instructions: toolInput.instructions,
          expectedResult: toolInput.expectedResult,
          ...(toolInput.runEnvironmentType && { runEnvironmentType: toolInput.runEnvironmentType }),
          ...(toolInput.workflowParams && { workflowParams: toolInput.workflowParams }),
        },
        timeoutMs: getWorkflowTimeoutMs(),
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-script-generation-bulk",
    description: "Start a bulk test script generation workflow to generate scripts for multiple test cases in a single request.",
    inputSchema: schemas.WorkflowStartTestScriptGenerationBulkInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowStartTestScriptGenerationBulkInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation/bulk`,
        body: {
          projectId: toolInput.projectId,
          name: toolInput.name,
          ...(toolInput.testCaseIds && { testCaseIds: toolInput.testCaseIds }),
          ...(toolInput.workflowParams && { workflowParams: toolInput.workflowParams }),
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
      const toolInput = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation/${toolInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-wf-get-latest-ts-gen-by-tc",
    description: "Get the latest test script generation runtime for a specific test case.",
    inputSchema: schemas.WorkflowGetLatestScriptGenByTestCaseInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowGetLatestScriptGenByTestCaseInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation/testcases/${toolInput.testCaseId}/runtime/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-script-replay",
    description: "Start a test script replay workflow to execute a single test script.",
    inputSchema: schemas.WorkflowStartTestScriptReplayInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowStartTestScriptReplayInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay`,
        body: {
          projectId: toolInput.projectId,
          useCaseId: toolInput.useCaseId,
          testCaseId: toolInput.testCaseId,
          testScriptId: toolInput.testScriptId,
          name: toolInput.name,
          ...(toolInput.workflowParams && { workflowParams: toolInput.workflowParams }),
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
      const toolInput = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/${toolInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-script-replay-bulk",
    description: "Start a bulk test script replay workflow to execute multiple test scripts.",
    inputSchema: schemas.WorkflowStartTestScriptReplayBulkInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowStartTestScriptReplayBulkInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/workflowRuntimes`,
        body: {
          projectId: toolInput.projectId,
          name: toolInput.name,
          intervalSec: toolInput.intervalSec,
          useCaseId: toolInput.useCaseId,
          namePrefix: toolInput.namePrefix,
          limit: toolInput.limit,
          testCaseIds: toolInput.testCaseIds,
          repeatPerTestCase: toolInput.repeatPerTestCase,
          ...(toolInput.workflowParams && { workflowParams: toolInput.workflowParams }),
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
      const toolInput = input as z.infer<typeof schemas.WorkflowListRuntimesInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/workflowRuntimes`,
        queryParams: { projectId: toolInput.projectId },
      };
    },
  },
  {
    name: "muggle-remote-wf-get-ts-replay-bulk-latest-run",
    description: "Get the latest run status for a bulk test script replay workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/${toolInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-wf-get-replay-bulk-batch-summary",
    description: "Get the summary of a bulk replay run batch.",
    inputSchema: schemas.WorkflowGetReplayBulkBatchSummaryInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowGetReplayBulkBatchSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/run-batch/${toolInput.runBatchId}/summary`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-cancel-run",
    description: "Cancel a running workflow run.",
    inputSchema: schemas.WorkflowCancelRunInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowCancelRunInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/runs/${toolInput.workflowRunId}/cancel`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-cancel-runtime",
    description: "Cancel a workflow runtime and all its runs.",
    inputSchema: schemas.WorkflowCancelRuntimeInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WorkflowCancelRuntimeInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/runtimes/${toolInput.workflowRuntimeId}/cancel`,
      };
    },
  },
  {
    name: "muggle-remote-local-run-upload",
    description: "Upload a locally executed run (generation/replay) to cloud workflow records.",
    inputSchema: schemas.LocalRunUploadInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.LocalRunUploadInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/local-run/upload`,
        body: {
          projectId: toolInput.projectId,
          useCaseId: toolInput.useCaseId,
          testCaseId: toolInput.testCaseId,
          runType: toolInput.runType,
          ...(toolInput.runEnvironmentType && { runEnvironmentType: toolInput.runEnvironmentType }),
          productionUrl: toolInput.productionUrl,
          localExecutionContext: {
            originalUrl: toolInput.localExecutionContext.originalUrl,
            productionUrl: toolInput.localExecutionContext.productionUrl,
            runByUserId: toolInput.localExecutionContext.runByUserId,
            machineHostname: toolInput.localExecutionContext.machineHostname,
            osInfo: toolInput.localExecutionContext.osInfo,
            electronAppVersion: toolInput.localExecutionContext.electronAppVersion,
            mcpServerVersion: toolInput.localExecutionContext.mcpServerVersion,
            localExecutionCompletedAt: toolInput.localExecutionContext.localExecutionCompletedAt,
            uploadedAt: toolInput.localExecutionContext.uploadedAt,
          },
          actionScript: toolInput.actionScript,
          status: toolInput.status,
          executionTimeMs: toolInput.executionTimeMs,
          errorMessage: toolInput.errorMessage,
        },
      };
    },
  },
];

const reportTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-project-test-results-summary-get",
    description: "Get a summary of test results for a project.",
    inputSchema: schemas.ProjectTestResultsSummaryInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ProjectTestResultsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/testResults`,
      };
    },
  },
  {
    name: "muggle-remote-project-test-scripts-summary-get",
    description:
      "Get a paginated, slimmed script-generation summary for a project. One row per TEST CASE, not per script: a test case with no script yet still gets a row, with `testScriptId` absent and a status such as TEST_CASE_DRAFTED. Row count is therefore a test-case count — do not read it as a number of scripts, and do not infer from a row's presence that a script exists. Response shape: { page, pageSize, totalCount, totalPages, hasMore, scripts: [{ status, testCaseId, testCaseTitle, useCaseId, useCaseTitle, testScriptId, lastRunAt, error }] }. Returns 20 rows per page by default (max 100). Check `hasMore` to decide whether to fetch additional pages. Use muggle-remote-test-script-get for full per-script detail.",
    inputSchema: schemas.ProjectTestScriptsSummaryInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ProjectTestScriptsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/test-scripts/summary`,
        queryParams: {
          page: toolInput.page,
          pageSize: toolInput.pageSize,
          sortBy: toolInput.sortBy,
          sortOrder: toolInput.sortOrder,
        },
      };
    },
    mapFromUpstream: mapTestScriptsSummary,
  },
  {
    name: "muggle-remote-project-test-runs-summary-get",
    description:
      "Get a paginated, slimmed summary of latest test runs for a project. Response shape: { page, pageSize, totalCount, totalPages, hasMore, runs: [{ status, testCaseId, testCaseTitle, useCaseId, useCaseTitle, lastRunAt, error, latestWorkflowRunId }] }. Returns 20 runs per page by default (max 100). `totalCount` is the project-wide total after the replay-status filter; `runs` is the page slice. Check `hasMore` to decide whether to fetch additional pages. Use muggle-remote-test-case-get / muggle-remote-wf-get-ts-replay-latest-run for full per-run detail.",
    inputSchema: schemas.ProjectTestRunsSummaryInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ProjectTestRunsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/test-runs/summary/paginated`,
        queryParams: {
          page: toolInput.page,
          pageSize: toolInput.pageSize,
          sortBy: toolInput.sortBy,
          sortOrder: toolInput.sortOrder,
        },
      };
    },
    mapFromUpstream: mapTestRunsSummary,
  },
  {
    name: "muggle-remote-report-stats-summary-get",
    description: "Get report statistics summary for a project.",
    inputSchema: schemas.ReportStatsSummaryInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ReportStatsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/report/stats-summary`,
        queryParams: { projectId: toolInput.projectId },
      };
    },
  },
  {
    name: "muggle-remote-report-cost-query",
    description: "Query cost/usage data for a project over a date range.",
    inputSchema: schemas.ReportCostQueryInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ReportCostQueryInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/report/cost/query`,
        body: {
          projectId: toolInput.projectId,
          startDateKey: toolInput.startDateKey,
          endDateKey: toolInput.endDateKey,
          filterType: toolInput.filterType,
          filterIds: toolInput.filterIds,
        },
      };
    },
  },
  {
    name: "muggle-remote-report-preferences-upsert",
    description: "Update report delivery preferences for a project.",
    inputSchema: schemas.ReportPreferencesUpsertInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ReportPreferencesUpsertInputSchema>;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/report/preferences`,
        body: {
          projectId: toolInput.projectId,
          channels: toolInput.channels,
          emails: toolInput.emails,
          phones: toolInput.phones,
          webhookUrl: toolInput.webhookUrl,
          defaultExportFormat: toolInput.defaultExportFormat,
        },
      };
    },
  },
  {
    name: "muggle-remote-report-final-generate",
    description: "Generate a final test report for a project.",
    inputSchema: schemas.ReportFinalGenerateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ReportFinalGenerateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/report/final/generate`,
        body: {
          projectId: toolInput.projectId,
          exportFormat: toolInput.exportFormat,
        },
        timeoutMs: getWorkflowTimeoutMs(),
      };
    },
  },
];

const secretTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-secret-list",
    description: "List all secrets for a project. Secret values are not returned for security.",
    inputSchema: schemas.SecretListInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.SecretListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/secrets`,
        queryParams: { projectId: toolInput.projectId },
      };
    },
  },
  {
    name: "muggle-remote-secret-create",
    description: "Create a new secret (credential) for a project.",
    inputSchema: schemas.SecretCreateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.SecretCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/secrets`,
        body: {
          projectId: toolInput.projectId,
          secretName: toolInput.name,
          value: toolInput.value,
          description: toolInput.description,
          source: toolInput.source,
        },
      };
    },
  },
  {
    name: "muggle-remote-secret-get",
    description: "Get details of a specific secret. The secret value is not returned for security.",
    inputSchema: schemas.SecretGetInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.SecretGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/secrets/${toolInput.secretId}`,
      };
    },
  },
  {
    name: "muggle-remote-secret-update",
    description: "Update an existing secret.",
    inputSchema: schemas.SecretUpdateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.SecretUpdateInputSchema>;
      const body: Record<string, unknown> = {};
      if (toolInput.name !== undefined) body.name = toolInput.name;
      if (toolInput.value !== undefined) body.value = toolInput.value;
      if (toolInput.description !== undefined) body.description = toolInput.description;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/secrets/${toolInput.secretId}`,
        body: body,
      };
    },
  },
  {
    name: "muggle-remote-secret-delete",
    description: "Delete a secret from a project.",
    inputSchema: schemas.SecretDeleteInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.SecretDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/secrets/${toolInput.secretId}`,
      };
    },
  },
];

const prdFileTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-prd-file-upload",
    description: "Upload a PRD file to a project. File content should be base64-encoded.",
    inputSchema: schemas.PrdFileUploadInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.PrdFileUploadInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/prd-file-upload`,
        multipartFormData: {
          fileFieldName: "file",
          fileName: toolInput.fileName,
          contentType: toolInput.contentType || "application/octet-stream",
          fileBase64: toolInput.contentBase64,
        },
      };
    },
  },
  {
    name: "muggle-remote-prd-file-list-by-project",
    description: "List all PRD files associated with a project.",
    inputSchema: schemas.PrdFileListInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.PrdFileListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/prd-files`,
      };
    },
  },
  {
    name: "muggle-remote-prd-file-delete",
    description: "Delete a PRD file from a project.",
    inputSchema: schemas.PrdFileDeleteInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.PrdFileDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/projects/${toolInput.projectId}/prd-files/${toolInput.prdFileId}`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-prd-file-process",
    description: "Start a PRD file processing workflow to extract use cases.",
    inputSchema: schemas.PrdFileProcessStartInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.PrdFileProcessStartInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/prd-file-process`,
        body: {
          projectId: toolInput.projectId,
          name: toolInput.name,
          description: toolInput.description,
          prdFilePath: toolInput.prdFilePath,
          originalFileName: toolInput.originalFileName,
          url: toolInput.url,
          contentChecksum: toolInput.contentChecksum,
          fileSize: toolInput.fileSize,
        },
      };
    },
  },
  {
    name: "muggle-remote-wf-get-prd-process-latest-run",
    description: "Get the latest run status of a PRD file processing workflow.",
    inputSchema: schemas.PrdFileProcessLatestRunInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.PrdFileProcessLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/prd-file-process/${toolInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
];

const walletTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-wallet-topup",
    description: "Create a Stripe checkout session to purchase a token package.",
    inputSchema: schemas.WalletTopUpInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WalletTopUpInputSchema>;
      return {
        method: "POST",
        path: "/v1/protected/wallet/topup",
        body: {
          packageId: toolInput.packageId,
          checkoutSuccessCallback: toolInput.checkoutSuccessCallback,
          checkoutCancelCallback: toolInput.checkoutCancelCallback,
        },
      };
    },
  },
  {
    name: "muggle-remote-wallet-pm-create-setup-session",
    description: "Create a Stripe setup session to add a payment method.",
    inputSchema: schemas.WalletPaymentMethodCreateSetupSessionInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WalletPaymentMethodCreateSetupSessionInputSchema>;
      return {
        method: "POST",
        path: "/v1/protected/wallet/payment-methods/setup",
        body: {
          checkoutSuccessCallback: toolInput.checkoutSuccessCallback,
          checkoutCancelCallback: toolInput.checkoutCancelCallback,
        },
      };
    },
  },
  {
    name: "muggle-remote-wallet-auto-topup-set-payment-method",
    description: "Set the saved payment method used by wallet auto top-up.",
    inputSchema: schemas.WalletAutoTopUpSetPaymentMethodInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.WalletAutoTopUpSetPaymentMethodInputSchema>;
      return {
        method: "PUT",
        path: "/v1/protected/wallet/auto-topup/payment-method",
        body: { paymentMethodId: toolInput.paymentMethodId },
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
      const toolInput = input as z.infer<typeof schemas.WalletAutoTopUpUpdateInputSchema>;
      return {
        method: "PUT",
        path: "/v1/protected/wallet/auto-topup",
        body: {
          enabled: toolInput.enabled,
          topUpTriggerTokenThreshold: toolInput.topUpTriggerTokenThreshold,
          packageId: toolInput.packageId,
        },
      };
    },
  },
];

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
      const toolInput = input as z.infer<typeof schemas.RecommendCicdSetupInputSchema>;
      const provider = toolInput?.repositoryProvider || "github";

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

/** API key endpoint prefix. */
const API_KEY_PREFIX = "/v1/protected/api-keys";

const apiKeyTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-auth-api-key-create",
    description: "Create a new API key for the authenticated user. Requires existing authentication.",
    inputSchema: schemas.ApiKeyCreateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ApiKeyCreateInputSchema>;
      return {
        method: "POST",
        path: API_KEY_PREFIX,
        body: {
          name: toolInput.name || "MCP Gateway Key",
          expiry: toolInput.expiry || "90d",
        },
      };
    },
    mapFromUpstream: (response) => {
      const toolInput = response.data as {
        id: string;
        key: string;
        name: string | null;
        status: string;
        prefix: string;
        lastFour: string;
        createdAt: number;
        expiresAt: number | null;
      };

      const maskedKey = `${toolInput.prefix}...${toolInput.lastFour}`;
      const expiresAt = toolInput.expiresAt
        ? new Date(toolInput.expiresAt).toISOString()
        : "never";

      return {
        success: true,
        message: "API key created.",
        apiKey: {
          id: toolInput.id,
          key: toolInput.key,
          hint: maskedKey,
          name: toolInput.name,
          status: toolInput.status,
          createdAt: new Date(toolInput.createdAt).toISOString(),
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
      const toolInput = input as z.infer<typeof schemas.ApiKeyGetInputSchema>;
      return {
        method: "GET",
        path: `${API_KEY_PREFIX}/${toolInput.apiKeyId}`,
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
    description: "Revoke an API key. The key will immediately stop working. Use muggle-remote-auth-api-key-list to find the key ID first.",
    inputSchema: schemas.ApiKeyRevokeInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.ApiKeyRevokeInputSchema>;
      return {
        method: "DELETE",
        path: `${API_KEY_PREFIX}/${toolInput.apiKeyId}`,
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

const userFeedbackTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-user-feedback-create",
    description:
      "Submit user feedback on a generated action script — either the whole script (targetType='actionScript', targetId=actionScriptId) or a specific step (targetType='step', targetId=`${actionScriptId}:${stepIndex}` with 0-based stepIndex). Persists the feedback and triggers an async feedback-analysis workflow that may regenerate the script. The response includes the saved feedback and, when the analysis workflow was started, a feedbackAnalysisWorkflowRuntimeId for polling.",
    inputSchema: schemas.UserFeedbackCreateInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UserFeedbackCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/user-feedback`,
        body: {
          projectId: toolInput.projectId,
          target: toolInput.target,
          feedbackText: toolInput.feedbackText,
        },
      };
    },
  },
  {
    name: "muggle-remote-user-feedback-list",
    description:
      "List active user feedback entries for a project. Optionally narrow by exactly one of actionScriptId / testScriptId / testCaseId / useCaseId — the typical query is 'show me feedback on this test case (or test script, or use case).' Supports limit/offset pagination. Response: { feedback: IUserFeedback[], total: number, hasMore: boolean }.",
    inputSchema: schemas.UserFeedbackListInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UserFeedbackListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/user-feedback`,
        queryParams: {
          projectId: toolInput.projectId,
          actionScriptId: toolInput.actionScriptId,
          testScriptId: toolInput.testScriptId,
          testCaseId: toolInput.testCaseId,
          useCaseId: toolInput.useCaseId,
          limit: toolInput.limit,
          offset: toolInput.offset,
        },
      };
    },
  },
  {
    name: "muggle-remote-user-feedback-delete",
    description: "Soft-delete a user feedback entry by ID. Returns 204 on success.",
    inputSchema: schemas.UserFeedbackDeleteInputSchema,
    mapToUpstream: (input) => {
      const toolInput = input as z.infer<typeof schemas.UserFeedbackDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/user-feedback/${toolInput.feedbackId}`,
      };
    },
  },
];

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
      const toolInput = input as z.infer<typeof schemas.AuthLoginInputSchema>;
      const authService = getAuthService();

      const deviceCodeResponse = await authService.startDeviceCodeFlow({
        forceNewSession: toolInput.forceNewSession,
      });
      const waitForCompletion = toolInput.waitForCompletion ?? true;

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
        timeoutMs: toolInput.timeoutMs,
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
      const toolInput = input as z.infer<typeof schemas.AuthPollInputSchema>;
      const authService = getAuthService();

      const deviceCode = toolInput.deviceCode ?? authService.getPendingDeviceCode();

      if (!deviceCode) {
        return {
          error: "NO_PENDING_LOGIN",
          message: "No pending login found. Please start a new login with muggle-remote-auth-login.",
        };
      }

      const devicePollOutcome = await authService.pollDeviceCode(deviceCode);

      if (devicePollOutcome.status === DeviceCodePollStatus.Complete) {
        return {
          status: "complete",
          success: true,
          email: devicePollOutcome.email,
          message: "Login complete. You are now authenticated.",
        };
      }

      return {
        status: devicePollOutcome.status,
        message: devicePollOutcome.message,
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
      const didLogout = authService.logout();

      if (didLogout) {
        return { success: true, message: "Successfully logged out." };
      }

      return { success: false, message: "No active session to log out from." };
    },
  },
];

/** All cloud E2E tool definitions (muggle-remote-* prefix). */
export const allQaToolDefinitions: IQaToolDefinition[] = [
  ...projectTools,
  ...useCaseTools,
  ...testCaseTools,
  ...bulkPreviewTools,
  ...testScriptTools,
  ...actionScriptTools,
  ...workflowTools,
  ...reportTools,
  ...secretTools,
  ...prdFileTools,
  ...walletTools,
  ...recommendationTools,
  ...apiKeyTools,
  ...userFeedbackTools,
  ...authTools,
];

/**
 * Get a cloud E2E tool definition by name.
 * @param name - Tool name.
 * @returns Tool definition or undefined.
 */
export function getQaToolByName(name: string): IQaToolDefinition | undefined {
  return allQaToolDefinitions.find((tool) => tool.name === name);
}

/**
 * Default response mapper.
 * @param response - Upstream response.
 * @returns Response toolInput.
 */
function defaultResponseMapper(response: IUpstreamResponse): unknown {
  return response.data;
}

/**
 * Execute a cloud E2E tool.
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

  const startTime = Date.now();
  safeTrack({
    name: EventName.McpToolInvoked,
    props: { toolName: toolName, toolSurface: ToolSurface.Remote, correlationId: correlationId },
  });

  let outcome: Outcome = Outcome.Success;
  let errorCode: string | undefined;
  try {
    // Validate input
    const validatedInput = tool.inputSchema.parse(input);

    // Check if tool has a local handler
    if (tool.localHandler) {
      const localHandlerOutput = await tool.localHandler(validatedInput);
      return {
        content: JSON.stringify(localHandlerOutput, null, 2),
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
      const mappedResponse = mapper(response, validatedInput);

      return {
        content: JSON.stringify(mappedResponse, null, 2),
        isError: false,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "RECOMMENDATION_ONLY") {
        // This is a recommendation tool, return static response
        const mapper = tool.mapFromUpstream || defaultResponseMapper;
        const mappedResponse = mapper({ statusCode: 200, data: {}, headers: {} }, validatedInput);
        return {
          content: JSON.stringify(mappedResponse, null, 2),
          isError: false,
        };
      }
      throw error;
    }
  } catch (error) {
    outcome = Outcome.Error;
    if (error instanceof GatewayError) {
      errorCode = error.code;
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

    errorCode = error instanceof Error ? error.name : "UnknownError";
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Tool call failed", { tool: toolName, error: errorMessage });
    return {
      content: JSON.stringify({ error: "INTERNAL_ERROR", message: errorMessage }),
      isError: true,
    };
  } finally {
    safeTrack({
      name: EventName.McpToolCompleted,
      props: {
        toolName: toolName,
        toolSurface: ToolSurface.Remote,
        correlationId: correlationId,
        durationMs: Date.now() - startTime,
        outcome: outcome,
        ...(errorCode !== undefined ? { errorCode: errorCode } : {}),
      },
    });
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
