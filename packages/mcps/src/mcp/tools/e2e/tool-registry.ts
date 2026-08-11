/**
 * Cloud E2E tool registry (muggle-remote-* prefix) — maps tool names to their implementations.
 */

import { z } from "zod";

import { getCallerCredentialsAsync } from "../../../shared/auth.js";
import { getConfig } from "../../../shared/config.js";
import { createChildLogger } from "../../../shared/logger.js";
import { registerAccount } from "../../../shared/register.js";
import { EventName, Outcome, ToolSurface, track } from "@muggleai/telemetry";
import type { IMcpToolResult } from "../../../shared/types.js";

import * as schemas from "../../e2e/contracts/index.js";
import { GatewayError, IQaToolDefinition, IUpstreamResponse } from "../../e2e/types.js";
import { getPromptServiceClient } from "../../e2e/upstream-client.js";
import { getAuthService } from "../../local/services/index.js";
import { DeviceCodePollStatus } from "../../local/types/index.js";
import { mapTestRunsSummary } from "./test-runs-summary-transform.js";

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
      const projectCreateInput = input as z.infer<typeof schemas.ProjectCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects`,
        body: {
          name: projectCreateInput.projectName,
          description: projectCreateInput.description,
          url: projectCreateInput.url,
        },
      };
    },
  },
  {
    name: "muggle-remote-project-get",
    description: "Get details of a specific project by ID.",
    inputSchema: schemas.ProjectGetInputSchema,
    mapToUpstream: (input) => {
      const projectGetInput = input as z.infer<typeof schemas.ProjectGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${projectGetInput.projectId}`,
      };
    },
  },
  {
    name: "muggle-remote-project-update",
    description: "Update an existing project's details.",
    inputSchema: schemas.ProjectUpdateInputSchema,
    mapToUpstream: (input) => {
      const projectUpdateInput = input as z.infer<typeof schemas.ProjectUpdateInputSchema>;
      const body: Record<string, unknown> = { id: projectUpdateInput.projectId };
      if (projectUpdateInput.projectName !== undefined) body.name = projectUpdateInput.projectName;
      if (projectUpdateInput.description !== undefined) body.description = projectUpdateInput.description;
      if (projectUpdateInput.url !== undefined) body.url = projectUpdateInput.url;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/projects/${projectUpdateInput.projectId}`,
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
      const projectListInput = input as z.infer<typeof schemas.ProjectListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects`,
        queryParams: {
          page: projectListInput.page,
          pageSize: projectListInput.pageSize,
          sortBy: projectListInput.sortBy,
          sortOrder: projectListInput.sortOrder,
        },
      };
    },
  },
  {
    name: "muggle-remote-project-delete",
    description: "Delete a project and all associated entities. This is a soft delete.",
    inputSchema: schemas.ProjectDeleteInputSchema,
    mapToUpstream: (input) => {
      const projectDeleteInput = input as z.infer<typeof schemas.ProjectDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/projects/${projectDeleteInput.projectId}`,
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
      const useCaseDiscoveryMemoryGetInput = input as z.infer<typeof schemas.UseCaseDiscoveryMemoryGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${useCaseDiscoveryMemoryGetInput.projectId}/use-case-discovery-memory`,
      };
    },
  },
  {
    name: "muggle-remote-use-case-candidates-approve",
    description: "Approve (graduate) selected use case candidates into actual use cases.",
    inputSchema: schemas.UseCaseCandidatesApproveInputSchema,
    mapToUpstream: (input) => {
      const useCaseCandidatesApproveInput = input as z.infer<typeof schemas.UseCaseCandidatesApproveInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${useCaseCandidatesApproveInput.projectId}/use-case-discovery-memory/graduate`,
        body: { approveIds: useCaseCandidatesApproveInput.approvedCandidateIds },
      };
    },
  },
  {
    name: "muggle-remote-use-case-list",
    description:
      "List use cases for a project. Returns up to 10 items per page by default (max 100). Response includes pagination metadata (totalCount, totalPages, hasMore) — check `hasMore` to decide whether to fetch additional pages.",
    inputSchema: schemas.UseCaseListInputSchema,
    mapToUpstream: (input) => {
      const useCaseListInput = input as z.infer<typeof schemas.UseCaseListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/use-cases`,
        queryParams: {
          projectId: useCaseListInput.projectId,
          page: useCaseListInput.page,
          pageSize: useCaseListInput.pageSize,
          sortBy: useCaseListInput.sortBy,
          sortOrder: useCaseListInput.sortOrder,
        },
      };
    },
  },
  {
    name: "muggle-remote-use-case-get",
    description: "Get details of a specific use case by ID.",
    inputSchema: schemas.UseCaseGetInputSchema,
    mapToUpstream: (input) => {
      const useCaseGetInput = input as z.infer<typeof schemas.UseCaseGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/use-cases/${useCaseGetInput.useCaseId}`,
      };
    },
  },
  {
    name: "muggle-remote-use-case-prompt-preview",
    description: "Preview a use case generated from a natural language instruction without saving.",
    inputSchema: schemas.UseCasePromptPreviewInputSchema,
    mapToUpstream: (input) => {
      const useCasePromptPreviewInput = input as z.infer<typeof schemas.UseCasePromptPreviewInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${useCasePromptPreviewInput.projectId}/use-cases/prompt/preview`,
        body: { instruction: useCasePromptPreviewInput.instruction },
      };
    },
  },
  {
    name: "muggle-remote-use-case-create-from-prompts",
    description: "Create one or more use cases from natural language instructions.",
    inputSchema: schemas.UseCaseCreateFromPromptsInputSchema,
    mapToUpstream: (input) => {
      const useCaseCreateFromPromptsInput = input as z.infer<typeof schemas.UseCaseCreateFromPromptsInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${useCaseCreateFromPromptsInput.projectId}/use-cases/prompts/bulk`,
        body: {
          projectId: useCaseCreateFromPromptsInput.projectId,
          prompts: useCaseCreateFromPromptsInput.instructions.map((instruction) => ({ instruction })),
        },
      };
    },
  },
  {
    name: "muggle-remote-use-case-update-from-prompt",
    description: "Update an existing use case by regenerating its fields from a new instruction.",
    inputSchema: schemas.UseCaseUpdateFromPromptInputSchema,
    mapToUpstream: (input) => {
      const useCaseUpdateFromPromptInput = input as z.infer<typeof schemas.UseCaseUpdateFromPromptInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${useCaseUpdateFromPromptInput.projectId}/use-cases/${useCaseUpdateFromPromptInput.useCaseId}/prompt`,
        body: { instruction: useCaseUpdateFromPromptInput.instruction },
      };
    },
  },
  {
    name: "muggle-remote-use-case-update",
    description: "Directly update an existing use case's fields without invoking the LLM. Pass only the fields you want to change — others are left untouched. Use this for cheap, deterministic edits (rename, flip status DRAFT→APPROVED, change priority, edit acceptance criteria). For LLM regeneration from a new instruction, use muggle-remote-use-case-update-from-prompt instead. Note: changing title, description, or url triggers background regeneration of dependent test cases on the server.",
    inputSchema: schemas.UseCaseUpdateInputSchema,
    mapToUpstream: (input) => {
      const useCaseUpdateInput = input as z.infer<typeof schemas.UseCaseUpdateInputSchema>;
      const body: Record<string, unknown> = { id: useCaseUpdateInput.useCaseId };
      if (useCaseUpdateInput.title !== undefined) body.title = useCaseUpdateInput.title;
      if (useCaseUpdateInput.description !== undefined) body.description = useCaseUpdateInput.description;
      if (useCaseUpdateInput.userStory !== undefined) body.userStory = useCaseUpdateInput.userStory;
      if (useCaseUpdateInput.url !== undefined) body.url = useCaseUpdateInput.url;
      if (useCaseUpdateInput.useCaseBreakdown !== undefined) body.useCaseBreakdown = useCaseUpdateInput.useCaseBreakdown;
      if (useCaseUpdateInput.status !== undefined) body.status = useCaseUpdateInput.status;
      if (useCaseUpdateInput.priority !== undefined) body.priority = useCaseUpdateInput.priority;
      if (useCaseUpdateInput.source !== undefined) body.source = useCaseUpdateInput.source;
      if (useCaseUpdateInput.category !== undefined) body.category = useCaseUpdateInput.category;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/use-cases/${useCaseUpdateInput.useCaseId}`,
        body: body,
      };
    },
  },
  {
    name: "muggle-remote-use-case-create",
    description: "Create a single use case from a fully-specified payload. Use this to persist use cases returned by muggle-remote-use-case-bulk-preview-submit — no LLM is invoked.",
    inputSchema: schemas.UseCaseCreateInputSchema,
    mapToUpstream: (input) => {
      const useCaseCreateInput = input as z.infer<typeof schemas.UseCaseCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/use-cases`,
        body: {
          projectId: useCaseCreateInput.projectId,
          title: useCaseCreateInput.title,
          description: useCaseCreateInput.description,
          userStory: useCaseCreateInput.userStory,
          url: useCaseCreateInput.url,
          useCaseBreakdown: useCaseCreateInput.useCaseBreakdown,
          status: useCaseCreateInput.status,
          priority: useCaseCreateInput.priority,
          source: useCaseCreateInput.source,
          category: useCaseCreateInput.category,
        },
      };
    },
  },
  {
    name: "muggle-remote-use-case-bulk-preview-submit",
    description: "Submit an async bulk-preview job that uses the OpenAI Batch API to generate use cases from many prompts at ~50% of normal LLM cost. Returns a job ID immediately; poll with muggle-remote-bulk-preview-job-get until the job reaches a terminal status, then persist each successful result via muggle-remote-use-case-create.",
    inputSchema: schemas.BulkPreviewSubmitUseCaseInputSchema,
    mapToUpstream: (input) => {
      const bulkPreviewSubmitUseCaseInput = input as z.infer<typeof schemas.BulkPreviewSubmitUseCaseInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${bulkPreviewSubmitUseCaseInput.projectId}/use-cases/prompts/bulk-preview`,
        body: { prompts: bulkPreviewSubmitUseCaseInput.prompts },
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
      const testCaseListInput = input as z.infer<typeof schemas.TestCaseListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-cases`,
        queryParams: {
          projectId: testCaseListInput.projectId,
          page: testCaseListInput.page,
          pageSize: testCaseListInput.pageSize,
          sortBy: testCaseListInput.sortBy,
          sortOrder: testCaseListInput.sortOrder,
        },
      };
    },
  },
  {
    name: "muggle-remote-test-case-get",
    description: "Get details of a specific test case.",
    inputSchema: schemas.TestCaseGetInputSchema,
    mapToUpstream: (input) => {
      const testCaseGetInput = input as z.infer<typeof schemas.TestCaseGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-cases/${testCaseGetInput.testCaseId}`,
      };
    },
  },
  {
    name: "muggle-remote-test-case-ancestors-get",
    description:
      "Resolve a test case's prerequisite chain from the project's test-plan graph. Returns { testCaseId, ancestors, orphan } where `ancestors` is an array of test case IDs ordered immediate-parent → root (empty when the case is a graph root). `orphan: true` means the case has no graph node, so it has no prerequisites. Call this before generating or replaying a script to ensure every prerequisite test case already has a ready script.",
    inputSchema: schemas.TestCaseAncestorsGetInputSchema,
    mapToUpstream: (input) => {
      const testCaseAncestorsGetInput = input as z.infer<typeof schemas.TestCaseAncestorsGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-plan-graph/test-cases/${testCaseAncestorsGetInput.testCaseId}/ancestors`,
      };
    },
  },
  {
    name: "muggle-remote-test-case-list-by-use-case",
    description: "List test cases for a specific use case.",
    inputSchema: schemas.TestCaseListByUseCaseInputSchema,
    mapToUpstream: (input) => {
      const testCaseListByUseCaseInput = input as z.infer<typeof schemas.TestCaseListByUseCaseInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/use-cases/${testCaseListByUseCaseInput.useCaseId}/test-cases`,
      };
    },
  },
  {
    name: "muggle-remote-test-case-generate-from-prompt",
    description: "Generate E2E acceptance test cases from a plain-English description of what to test — e.g., 'test the signup flow with invalid email' or 'verify the checkout handles empty cart'. Returns preview test cases that can be used to generate executable browser test scripts.",
    inputSchema: schemas.TestCaseGenerateFromPromptInputSchema,
    mapToUpstream: (input) => {
      const testCaseGenerateFromPromptInput = input as z.infer<typeof schemas.TestCaseGenerateFromPromptInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${testCaseGenerateFromPromptInput.projectId}/use-cases/${testCaseGenerateFromPromptInput.useCaseId}/test-cases/prompt/preview`,
        body: { instruction: testCaseGenerateFromPromptInput.instruction },
      };
    },
  },
  {
    name: "muggle-remote-test-case-create",
    description: "Create a new test case for a use case.",
    inputSchema: schemas.TestCaseCreateInputSchema,
    mapToUpstream: (input) => {
      const testCaseCreateInput = input as z.infer<typeof schemas.TestCaseCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/test-cases`,
        body: {
          projectId: testCaseCreateInput.projectId,
          useCaseId: testCaseCreateInput.useCaseId,
          title: testCaseCreateInput.title,
          description: testCaseCreateInput.description,
          goal: testCaseCreateInput.goal,
          precondition: testCaseCreateInput.precondition,
          expectedResult: testCaseCreateInput.expectedResult,
          url: testCaseCreateInput.url,
          status: testCaseCreateInput.status || "DRAFT",
          priority: testCaseCreateInput.priority || "MEDIUM",
          tags: testCaseCreateInput.tags || [],
          category: testCaseCreateInput.category || "Functional",
          automated: testCaseCreateInput.automated ?? true,
        },
      };
    },
  },
  {
    name: "muggle-remote-test-case-update",
    description: "Directly update an existing test case's fields. Pass only the fields you want to change — others are left untouched. Use this for cheap, deterministic edits (rename, change status/priority, fix expected result, add tags). Does not touch the associated test script — script regeneration is a separate workflow (muggle-remote-workflow-start-test-script-generation).",
    inputSchema: schemas.TestCaseUpdateInputSchema,
    mapToUpstream: (input) => {
      const testCaseUpdateInput = input as z.infer<typeof schemas.TestCaseUpdateInputSchema>;
      const body: Record<string, unknown> = { id: testCaseUpdateInput.testCaseId };
      if (testCaseUpdateInput.title !== undefined) body.title = testCaseUpdateInput.title;
      if (testCaseUpdateInput.description !== undefined) body.description = testCaseUpdateInput.description;
      if (testCaseUpdateInput.goal !== undefined) body.goal = testCaseUpdateInput.goal;
      if (testCaseUpdateInput.precondition !== undefined) body.precondition = testCaseUpdateInput.precondition;
      if (testCaseUpdateInput.expectedResult !== undefined) body.expectedResult = testCaseUpdateInput.expectedResult;
      if (testCaseUpdateInput.url !== undefined) body.url = testCaseUpdateInput.url;
      if (testCaseUpdateInput.status !== undefined) body.status = testCaseUpdateInput.status;
      if (testCaseUpdateInput.priority !== undefined) body.priority = testCaseUpdateInput.priority;
      if (testCaseUpdateInput.tags !== undefined) body.tags = testCaseUpdateInput.tags;
      if (testCaseUpdateInput.category !== undefined) body.category = testCaseUpdateInput.category;
      if (testCaseUpdateInput.automated !== undefined) body.automated = testCaseUpdateInput.automated;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/test-cases/${testCaseUpdateInput.testCaseId}`,
        body: body,
      };
    },
  },
  {
    name: "muggle-remote-test-case-bulk-preview-submit",
    description: "Submit an async bulk-preview job that uses the OpenAI Batch API to generate test cases for a single use case from many prompts at ~50% of normal LLM cost. Returns a job ID immediately; poll with muggle-remote-bulk-preview-job-get until the job reaches a terminal status, then persist each successful result via muggle-remote-test-case-create. Note: one input prompt may fan out to 1–5 test cases.",
    inputSchema: schemas.BulkPreviewSubmitTestCaseInputSchema,
    mapToUpstream: (input) => {
      const bulkPreviewSubmitTestCaseInput = input as z.infer<typeof schemas.BulkPreviewSubmitTestCaseInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/projects/${bulkPreviewSubmitTestCaseInput.projectId}/use-cases/${bulkPreviewSubmitTestCaseInput.useCaseId}/test-cases/prompts/bulk-preview`,
        body: { prompts: bulkPreviewSubmitTestCaseInput.prompts },
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
      const bulkPreviewJobGetInput = input as z.infer<typeof schemas.BulkPreviewJobGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${bulkPreviewJobGetInput.projectId}/bulk-preview-jobs/${bulkPreviewJobGetInput.jobId}`,
      };
    },
  },
  {
    name: "muggle-remote-bulk-preview-job-list",
    description: "List bulk-preview jobs for a project, optionally filtered by status or kind.",
    inputSchema: schemas.BulkPreviewJobListInputSchema,
    mapToUpstream: (input) => {
      const bulkPreviewJobListInput = input as z.infer<typeof schemas.BulkPreviewJobListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${bulkPreviewJobListInput.projectId}/bulk-preview-jobs`,
        queryParams: {
          status: bulkPreviewJobListInput.status?.join(","),
          kind: bulkPreviewJobListInput.kind,
          limit: bulkPreviewJobListInput.limit,
          cursor: bulkPreviewJobListInput.cursor,
        },
      };
    },
  },
  {
    name: "muggle-remote-bulk-preview-job-cancel",
    description: "Request cancellation of a bulk-preview job. Cancellation is cooperative — the harvester picks it up on its next tick and moves the job to status=cancelled.",
    inputSchema: schemas.BulkPreviewJobCancelInputSchema,
    mapToUpstream: (input) => {
      const bulkPreviewJobCancelInput = input as z.infer<typeof schemas.BulkPreviewJobCancelInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/projects/${bulkPreviewJobCancelInput.projectId}/bulk-preview-jobs/${bulkPreviewJobCancelInput.jobId}`,
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
      const testScriptListInput = input as z.infer<typeof schemas.TestScriptListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-scripts`,
        queryParams: {
          projectId: testScriptListInput.projectId,
          testCaseId: testScriptListInput.testCaseId,
          runEnvironmentType: testScriptListInput.runEnvironmentType,
          page: testScriptListInput.page,
          pageSize: testScriptListInput.pageSize,
          sortBy: testScriptListInput.sortBy,
          sortOrder: testScriptListInput.sortOrder,
        },
      };
    },
  },
  {
    name: "muggle-remote-test-script-get",
    description: "Get details of a specific test script.",
    inputSchema: schemas.TestScriptGetInputSchema,
    mapToUpstream: (input) => {
      const testScriptGetInput = input as z.infer<typeof schemas.TestScriptGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/test-scripts/${testScriptGetInput.testScriptId}`,
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
      const actionScriptGetInput = input as z.infer<typeof schemas.ActionScriptGetInputSchema>;
      return {
        method: "GET",
        path: `/v1/protected/actionScript/${actionScriptGetInput.actionScriptId}`,
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
      const workflowStartWebsiteScanInput = input as z.infer<typeof schemas.WorkflowStartWebsiteScanInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/website-scan`,
        body: {
          projectId: workflowStartWebsiteScanInput.projectId,
          url: workflowStartWebsiteScanInput.url,
          description: workflowStartWebsiteScanInput.description,
          archiveUnapproved: workflowStartWebsiteScanInput.archiveUnapproved,
          ...(workflowStartWebsiteScanInput.workflowParams && { workflowParams: workflowStartWebsiteScanInput.workflowParams }),
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
      const workflowListRuntimesInput = input as z.infer<typeof schemas.WorkflowListRuntimesInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/website-scan/workflowRuntimes`,
        queryParams: { projectId: workflowListRuntimesInput.projectId },
      };
    },
  },
  {
    name: "muggle-remote-workflow-get-website-scan-latest-run",
    description: "Get the latest run status for a website scan workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const workflowGetLatestRunInput = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/website-scan/${workflowGetLatestRunInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-case-detection",
    description: "Start a test case detection workflow to generate test cases from use cases.",
    inputSchema: schemas.WorkflowStartTestCaseDetectionInputSchema,
    mapToUpstream: (input) => {
      const workflowStartTestCaseDetectionInput = input as z.infer<typeof schemas.WorkflowStartTestCaseDetectionInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-case/test-case-detection`,
        body: {
          projectId: workflowStartTestCaseDetectionInput.projectId,
          useCaseId: workflowStartTestCaseDetectionInput.useCaseId,
          name: workflowStartTestCaseDetectionInput.name,
          description: workflowStartTestCaseDetectionInput.description,
          url: workflowStartTestCaseDetectionInput.url,
          ...(workflowStartTestCaseDetectionInput.workflowParams && { workflowParams: workflowStartTestCaseDetectionInput.workflowParams }),
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
      const workflowListRuntimesInput = input as z.infer<typeof schemas.WorkflowListRuntimesInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-case/test-case-detection/workflowRuntimes`,
        queryParams: { projectId: workflowListRuntimesInput.projectId },
      };
    },
  },
  {
    name: "muggle-remote-wf-get-tc-detect-latest-run",
    description: "Get the latest run status for a test case detection workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const workflowGetLatestRunInput = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-case/test-case-detection/${workflowGetLatestRunInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-script-generation",
    description: "Start a test script generation workflow.",
    inputSchema: schemas.WorkflowStartTestScriptGenerationInputSchema,
    mapToUpstream: (input) => {
      const workflowStartTestScriptGenerationInput = input as z.infer<typeof schemas.WorkflowStartTestScriptGenerationInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation`,
        body: {
          projectId: workflowStartTestScriptGenerationInput.projectId,
          testCaseId: workflowStartTestScriptGenerationInput.testCaseId,
          useCaseId: workflowStartTestScriptGenerationInput.useCaseId,
          name: workflowStartTestScriptGenerationInput.name,
          url: workflowStartTestScriptGenerationInput.url,
          goal: workflowStartTestScriptGenerationInput.goal,
          precondition: workflowStartTestScriptGenerationInput.precondition,
          instructions: workflowStartTestScriptGenerationInput.instructions,
          expectedResult: workflowStartTestScriptGenerationInput.expectedResult,
          ...(workflowStartTestScriptGenerationInput.runEnvironmentType && { runEnvironmentType: workflowStartTestScriptGenerationInput.runEnvironmentType }),
          ...(workflowStartTestScriptGenerationInput.workflowParams && { workflowParams: workflowStartTestScriptGenerationInput.workflowParams }),
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
      const workflowStartTestScriptGenerationBulkInput = input as z.infer<typeof schemas.WorkflowStartTestScriptGenerationBulkInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation/bulk`,
        body: {
          projectId: workflowStartTestScriptGenerationBulkInput.projectId,
          name: workflowStartTestScriptGenerationBulkInput.name,
          ...(workflowStartTestScriptGenerationBulkInput.testCaseIds && { testCaseIds: workflowStartTestScriptGenerationBulkInput.testCaseIds }),
          ...(workflowStartTestScriptGenerationBulkInput.workflowParams && { workflowParams: workflowStartTestScriptGenerationBulkInput.workflowParams }),
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
      const workflowGetLatestRunInput = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation/${workflowGetLatestRunInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-wf-get-latest-ts-gen-by-tc",
    description: "Get the latest test script generation runtime for a specific test case.",
    inputSchema: schemas.WorkflowGetLatestScriptGenByTestCaseInputSchema,
    mapToUpstream: (input) => {
      const workflowGetLatestScriptGenByTestCaseInput = input as z.infer<typeof schemas.WorkflowGetLatestScriptGenByTestCaseInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-generation/testcases/${workflowGetLatestScriptGenByTestCaseInput.testCaseId}/runtime/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-script-replay",
    description: "Start a test script replay workflow to execute a single test script.",
    inputSchema: schemas.WorkflowStartTestScriptReplayInputSchema,
    mapToUpstream: (input) => {
      const workflowStartTestScriptReplayInput = input as z.infer<typeof schemas.WorkflowStartTestScriptReplayInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay`,
        body: {
          projectId: workflowStartTestScriptReplayInput.projectId,
          useCaseId: workflowStartTestScriptReplayInput.useCaseId,
          testCaseId: workflowStartTestScriptReplayInput.testCaseId,
          testScriptId: workflowStartTestScriptReplayInput.testScriptId,
          name: workflowStartTestScriptReplayInput.name,
          ...(workflowStartTestScriptReplayInput.workflowParams && { workflowParams: workflowStartTestScriptReplayInput.workflowParams }),
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
      const workflowGetLatestRunInput = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/${workflowGetLatestRunInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-test-script-replay-bulk",
    description: "Start a bulk test script replay workflow to execute multiple test scripts.",
    inputSchema: schemas.WorkflowStartTestScriptReplayBulkInputSchema,
    mapToUpstream: (input) => {
      const workflowStartTestScriptReplayBulkInput = input as z.infer<typeof schemas.WorkflowStartTestScriptReplayBulkInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/workflowRuntimes`,
        body: {
          projectId: workflowStartTestScriptReplayBulkInput.projectId,
          name: workflowStartTestScriptReplayBulkInput.name,
          intervalSec: workflowStartTestScriptReplayBulkInput.intervalSec,
          useCaseId: workflowStartTestScriptReplayBulkInput.useCaseId,
          namePrefix: workflowStartTestScriptReplayBulkInput.namePrefix,
          limit: workflowStartTestScriptReplayBulkInput.limit,
          testCaseIds: workflowStartTestScriptReplayBulkInput.testCaseIds,
          repeatPerTestCase: workflowStartTestScriptReplayBulkInput.repeatPerTestCase,
          ...(workflowStartTestScriptReplayBulkInput.workflowParams && { workflowParams: workflowStartTestScriptReplayBulkInput.workflowParams }),
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
      const workflowListRuntimesInput = input as z.infer<typeof schemas.WorkflowListRuntimesInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/workflowRuntimes`,
        queryParams: { projectId: workflowListRuntimesInput.projectId },
      };
    },
  },
  {
    name: "muggle-remote-wf-get-ts-replay-bulk-latest-run",
    description: "Get the latest run status for a bulk test script replay workflow runtime.",
    inputSchema: schemas.WorkflowGetLatestRunInputSchema,
    mapToUpstream: (input) => {
      const workflowGetLatestRunInput = input as z.infer<typeof schemas.WorkflowGetLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/${workflowGetLatestRunInput.workflowRuntimeId}/run/latest`,
      };
    },
  },
  {
    name: "muggle-remote-wf-get-replay-bulk-batch-summary",
    description: "Get the summary of a bulk replay run batch.",
    inputSchema: schemas.WorkflowGetReplayBulkBatchSummaryInputSchema,
    mapToUpstream: (input) => {
      const workflowGetReplayBulkBatchSummaryInput = input as z.infer<typeof schemas.WorkflowGetReplayBulkBatchSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/run-batch/${workflowGetReplayBulkBatchSummaryInput.runBatchId}/summary`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-cancel-run",
    description: "Cancel a running workflow run.",
    inputSchema: schemas.WorkflowCancelRunInputSchema,
    mapToUpstream: (input) => {
      const workflowCancelRunInput = input as z.infer<typeof schemas.WorkflowCancelRunInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/runs/${workflowCancelRunInput.workflowRunId}/cancel`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-cancel-runtime",
    description: "Cancel a workflow runtime and all its runs.",
    inputSchema: schemas.WorkflowCancelRuntimeInputSchema,
    mapToUpstream: (input) => {
      const workflowCancelRuntimeInput = input as z.infer<typeof schemas.WorkflowCancelRuntimeInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/runtimes/${workflowCancelRuntimeInput.workflowRuntimeId}/cancel`,
      };
    },
  },
  {
    name: "muggle-remote-local-run-upload",
    description: "Upload a locally executed run (generation/replay) to cloud workflow records.",
    inputSchema: schemas.LocalRunUploadInputSchema,
    mapToUpstream: (input) => {
      const localRunUploadInput = input as z.infer<typeof schemas.LocalRunUploadInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/local-run/upload`,
        body: {
          projectId: localRunUploadInput.projectId,
          useCaseId: localRunUploadInput.useCaseId,
          testCaseId: localRunUploadInput.testCaseId,
          runType: localRunUploadInput.runType,
          ...(localRunUploadInput.runEnvironmentType && { runEnvironmentType: localRunUploadInput.runEnvironmentType }),
          productionUrl: localRunUploadInput.productionUrl,
          localExecutionContext: {
            originalUrl: localRunUploadInput.localExecutionContext.originalUrl,
            productionUrl: localRunUploadInput.localExecutionContext.productionUrl,
            runByUserId: localRunUploadInput.localExecutionContext.runByUserId,
            machineHostname: localRunUploadInput.localExecutionContext.machineHostname,
            osInfo: localRunUploadInput.localExecutionContext.osInfo,
            electronAppVersion: localRunUploadInput.localExecutionContext.electronAppVersion,
            mcpServerVersion: localRunUploadInput.localExecutionContext.mcpServerVersion,
            localExecutionCompletedAt: localRunUploadInput.localExecutionContext.localExecutionCompletedAt,
            uploadedAt: localRunUploadInput.localExecutionContext.uploadedAt,
          },
          actionScript: localRunUploadInput.actionScript,
          status: localRunUploadInput.status,
          executionTimeMs: localRunUploadInput.executionTimeMs,
          errorMessage: localRunUploadInput.errorMessage,
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
      const projectTestResultsSummaryInput = input as z.infer<typeof schemas.ProjectTestResultsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${projectTestResultsSummaryInput.projectId}/testResults`,
      };
    },
  },
  {
    name: "muggle-remote-project-test-scripts-summary-get",
    description: "Get a summary of test scripts for a project.",
    inputSchema: schemas.ProjectTestScriptsSummaryInputSchema,
    mapToUpstream: (input) => {
      const projectTestScriptsSummaryInput = input as z.infer<typeof schemas.ProjectTestScriptsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${projectTestScriptsSummaryInput.projectId}/test-scripts/summary`,
      };
    },
  },
  {
    name: "muggle-remote-project-test-runs-summary-get",
    description:
      "Get a paginated, slimmed summary of latest test runs for a project. Response shape: { page, pageSize, totalCount, totalPages, hasMore, runs: [{ status, testCaseId, testCaseTitle, useCaseId, useCaseTitle, lastRunAt, error, latestWorkflowRunId }] }. Returns 20 runs per page by default (max 100). `totalCount` is the project-wide total after the replay-status filter; `runs` is the page slice. Check `hasMore` to decide whether to fetch additional pages. Use muggle-remote-test-case-get / muggle-remote-wf-get-ts-replay-latest-run for full per-run detail.",
    inputSchema: schemas.ProjectTestRunsSummaryInputSchema,
    mapToUpstream: (input) => {
      const projectTestRunsSummaryInput = input as z.infer<typeof schemas.ProjectTestRunsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${projectTestRunsSummaryInput.projectId}/test-runs/summary/paginated`,
        queryParams: {
          page: projectTestRunsSummaryInput.page,
          pageSize: projectTestRunsSummaryInput.pageSize,
          sortBy: projectTestRunsSummaryInput.sortBy,
          sortOrder: projectTestRunsSummaryInput.sortOrder,
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
      const reportStatsSummaryInput = input as z.infer<typeof schemas.ReportStatsSummaryInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/report/stats-summary`,
        queryParams: { projectId: reportStatsSummaryInput.projectId },
      };
    },
  },
  {
    name: "muggle-remote-report-cost-query",
    description: "Query cost/usage data for a project over a date range.",
    inputSchema: schemas.ReportCostQueryInputSchema,
    mapToUpstream: (input) => {
      const reportCostQueryInput = input as z.infer<typeof schemas.ReportCostQueryInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/report/cost/query`,
        body: {
          projectId: reportCostQueryInput.projectId,
          startDateKey: reportCostQueryInput.startDateKey,
          endDateKey: reportCostQueryInput.endDateKey,
          filterType: reportCostQueryInput.filterType,
          filterIds: reportCostQueryInput.filterIds,
        },
      };
    },
  },
  {
    name: "muggle-remote-report-preferences-upsert",
    description: "Update report delivery preferences for a project.",
    inputSchema: schemas.ReportPreferencesUpsertInputSchema,
    mapToUpstream: (input) => {
      const reportPreferencesUpsertInput = input as z.infer<typeof schemas.ReportPreferencesUpsertInputSchema>;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/report/preferences`,
        body: {
          projectId: reportPreferencesUpsertInput.projectId,
          channels: reportPreferencesUpsertInput.channels,
          emails: reportPreferencesUpsertInput.emails,
          phones: reportPreferencesUpsertInput.phones,
          webhookUrl: reportPreferencesUpsertInput.webhookUrl,
          defaultExportFormat: reportPreferencesUpsertInput.defaultExportFormat,
        },
      };
    },
  },
  {
    name: "muggle-remote-report-final-generate",
    description: "Generate a final test report for a project.",
    inputSchema: schemas.ReportFinalGenerateInputSchema,
    mapToUpstream: (input) => {
      const reportFinalGenerateInput = input as z.infer<typeof schemas.ReportFinalGenerateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/report/final/generate`,
        body: {
          projectId: reportFinalGenerateInput.projectId,
          exportFormat: reportFinalGenerateInput.exportFormat,
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
      const secretListInput = input as z.infer<typeof schemas.SecretListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/secrets`,
        queryParams: { projectId: secretListInput.projectId },
      };
    },
  },
  {
    name: "muggle-remote-secret-create",
    description: "Create a new secret (credential) for a project.",
    inputSchema: schemas.SecretCreateInputSchema,
    mapToUpstream: (input) => {
      const secretCreateInput = input as z.infer<typeof schemas.SecretCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/secrets`,
        body: {
          projectId: secretCreateInput.projectId,
          secretName: secretCreateInput.name,
          value: secretCreateInput.value,
          description: secretCreateInput.description,
          source: secretCreateInput.source,
        },
      };
    },
  },
  {
    name: "muggle-remote-secret-get",
    description: "Get details of a specific secret. The secret value is not returned for security.",
    inputSchema: schemas.SecretGetInputSchema,
    mapToUpstream: (input) => {
      const secretGetInput = input as z.infer<typeof schemas.SecretGetInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/secrets/${secretGetInput.secretId}`,
      };
    },
  },
  {
    name: "muggle-remote-secret-update",
    description: "Update an existing secret.",
    inputSchema: schemas.SecretUpdateInputSchema,
    mapToUpstream: (input) => {
      const secretUpdateInput = input as z.infer<typeof schemas.SecretUpdateInputSchema>;
      const body: Record<string, unknown> = {};
      if (secretUpdateInput.name !== undefined) body.name = secretUpdateInput.name;
      if (secretUpdateInput.value !== undefined) body.value = secretUpdateInput.value;
      if (secretUpdateInput.description !== undefined) body.description = secretUpdateInput.description;
      return {
        method: "PUT",
        path: `${MUGGLE_TEST_PREFIX}/secrets/${secretUpdateInput.secretId}`,
        body: body,
      };
    },
  },
  {
    name: "muggle-remote-secret-delete",
    description: "Delete a secret from a project.",
    inputSchema: schemas.SecretDeleteInputSchema,
    mapToUpstream: (input) => {
      const secretDeleteInput = input as z.infer<typeof schemas.SecretDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/secrets/${secretDeleteInput.secretId}`,
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
      const prdFileUploadInput = input as z.infer<typeof schemas.PrdFileUploadInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/prd-file-upload`,
        multipartFormData: {
          fileFieldName: "file",
          fileName: prdFileUploadInput.fileName,
          contentType: prdFileUploadInput.contentType || "application/octet-stream",
          fileBase64: prdFileUploadInput.contentBase64,
        },
      };
    },
  },
  {
    name: "muggle-remote-prd-file-list-by-project",
    description: "List all PRD files associated with a project.",
    inputSchema: schemas.PrdFileListInputSchema,
    mapToUpstream: (input) => {
      const prdFileListInput = input as z.infer<typeof schemas.PrdFileListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/projects/${prdFileListInput.projectId}/prd-files`,
      };
    },
  },
  {
    name: "muggle-remote-prd-file-delete",
    description: "Delete a PRD file from a project.",
    inputSchema: schemas.PrdFileDeleteInputSchema,
    mapToUpstream: (input) => {
      const prdFileDeleteInput = input as z.infer<typeof schemas.PrdFileDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/projects/${prdFileDeleteInput.projectId}/prd-files/${prdFileDeleteInput.prdFileId}`,
      };
    },
  },
  {
    name: "muggle-remote-workflow-start-prd-file-process",
    description: "Start a PRD file processing workflow to extract use cases.",
    inputSchema: schemas.PrdFileProcessStartInputSchema,
    mapToUpstream: (input) => {
      const prdFileProcessStartInput = input as z.infer<typeof schemas.PrdFileProcessStartInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/prd-file-process`,
        body: {
          projectId: prdFileProcessStartInput.projectId,
          name: prdFileProcessStartInput.name,
          description: prdFileProcessStartInput.description,
          prdFilePath: prdFileProcessStartInput.prdFilePath,
          originalFileName: prdFileProcessStartInput.originalFileName,
          url: prdFileProcessStartInput.url,
          contentChecksum: prdFileProcessStartInput.contentChecksum,
          fileSize: prdFileProcessStartInput.fileSize,
        },
      };
    },
  },
  {
    name: "muggle-remote-wf-get-prd-process-latest-run",
    description: "Get the latest run status of a PRD file processing workflow.",
    inputSchema: schemas.PrdFileProcessLatestRunInputSchema,
    mapToUpstream: (input) => {
      const prdFileProcessLatestRunInput = input as z.infer<typeof schemas.PrdFileProcessLatestRunInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/workflow/use-case/prd-file-process/${prdFileProcessLatestRunInput.workflowRuntimeId}/run/latest`,
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
      const walletTopUpInput = input as z.infer<typeof schemas.WalletTopUpInputSchema>;
      return {
        method: "POST",
        path: "/v1/protected/wallet/topup",
        body: {
          packageId: walletTopUpInput.packageId,
          checkoutSuccessCallback: walletTopUpInput.checkoutSuccessCallback,
          checkoutCancelCallback: walletTopUpInput.checkoutCancelCallback,
        },
      };
    },
  },
  {
    name: "muggle-remote-wallet-pm-create-setup-session",
    description: "Create a Stripe setup session to add a payment method.",
    inputSchema: schemas.WalletPaymentMethodCreateSetupSessionInputSchema,
    mapToUpstream: (input) => {
      const walletPaymentMethodCreateSetupSessionInput = input as z.infer<typeof schemas.WalletPaymentMethodCreateSetupSessionInputSchema>;
      return {
        method: "POST",
        path: "/v1/protected/wallet/payment-methods/setup",
        body: {
          checkoutSuccessCallback: walletPaymentMethodCreateSetupSessionInput.checkoutSuccessCallback,
          checkoutCancelCallback: walletPaymentMethodCreateSetupSessionInput.checkoutCancelCallback,
        },
      };
    },
  },
  {
    name: "muggle-remote-wallet-auto-topup-set-payment-method",
    description: "Set the saved payment method used by wallet auto top-up.",
    inputSchema: schemas.WalletAutoTopUpSetPaymentMethodInputSchema,
    mapToUpstream: (input) => {
      const walletAutoTopUpSetPaymentMethodInput = input as z.infer<typeof schemas.WalletAutoTopUpSetPaymentMethodInputSchema>;
      return {
        method: "PUT",
        path: "/v1/protected/wallet/auto-topup/payment-method",
        body: { paymentMethodId: walletAutoTopUpSetPaymentMethodInput.paymentMethodId },
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
      const walletAutoTopUpUpdateInput = input as z.infer<typeof schemas.WalletAutoTopUpUpdateInputSchema>;
      return {
        method: "PUT",
        path: "/v1/protected/wallet/auto-topup",
        body: {
          enabled: walletAutoTopUpUpdateInput.enabled,
          topUpTriggerTokenThreshold: walletAutoTopUpUpdateInput.topUpTriggerTokenThreshold,
          packageId: walletAutoTopUpUpdateInput.packageId,
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
      const recommendCicdSetupInput = input as z.infer<typeof schemas.RecommendCicdSetupInputSchema>;
      const provider = recommendCicdSetupInput?.repositoryProvider || "github";

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
      const apiKeyCreateInput = input as z.infer<typeof schemas.ApiKeyCreateInputSchema>;
      return {
        method: "POST",
        path: API_KEY_PREFIX,
        body: {
          name: apiKeyCreateInput.name || "MCP Gateway Key",
          expiry: apiKeyCreateInput.expiry || "90d",
        },
      };
    },
    mapFromUpstream: (response) => {
      const costQueryResponse = response.data as {
        id: string;
        key: string;
        name: string | null;
        status: string;
        prefix: string;
        lastFour: string;
        createdAt: number;
        expiresAt: number | null;
      };

      const maskedKey = `${costQueryResponse.prefix}...${costQueryResponse.lastFour}`;
      const expiresAt = costQueryResponse.expiresAt
        ? new Date(costQueryResponse.expiresAt).toISOString()
        : "never";

      return {
        success: true,
        message: "API key created.",
        apiKey: {
          id: costQueryResponse.id,
          key: costQueryResponse.key,
          hint: maskedKey,
          name: costQueryResponse.name,
          status: costQueryResponse.status,
          createdAt: new Date(costQueryResponse.createdAt).toISOString(),
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
      const apiKeyGetInput = input as z.infer<typeof schemas.ApiKeyGetInputSchema>;
      return {
        method: "GET",
        path: `${API_KEY_PREFIX}/${apiKeyGetInput.apiKeyId}`,
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
      const apiKeyRevokeInput = input as z.infer<typeof schemas.ApiKeyRevokeInputSchema>;
      return {
        method: "DELETE",
        path: `${API_KEY_PREFIX}/${apiKeyRevokeInput.apiKeyId}`,
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
      const userFeedbackCreateInput = input as z.infer<typeof schemas.UserFeedbackCreateInputSchema>;
      return {
        method: "POST",
        path: `${MUGGLE_TEST_PREFIX}/user-feedback`,
        body: {
          projectId: userFeedbackCreateInput.projectId,
          target: userFeedbackCreateInput.target,
          feedbackText: userFeedbackCreateInput.feedbackText,
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
      const userFeedbackListInput = input as z.infer<typeof schemas.UserFeedbackListInputSchema>;
      return {
        method: "GET",
        path: `${MUGGLE_TEST_PREFIX}/user-feedback`,
        queryParams: {
          projectId: userFeedbackListInput.projectId,
          actionScriptId: userFeedbackListInput.actionScriptId,
          testScriptId: userFeedbackListInput.testScriptId,
          testCaseId: userFeedbackListInput.testCaseId,
          useCaseId: userFeedbackListInput.useCaseId,
          limit: userFeedbackListInput.limit,
          offset: userFeedbackListInput.offset,
        },
      };
    },
  },
  {
    name: "muggle-remote-user-feedback-delete",
    description: "Soft-delete a user feedback entry by ID. Returns 204 on success.",
    inputSchema: schemas.UserFeedbackDeleteInputSchema,
    mapToUpstream: (input) => {
      const userFeedbackDeleteInput = input as z.infer<typeof schemas.UserFeedbackDeleteInputSchema>;
      return {
        method: "DELETE",
        path: `${MUGGLE_TEST_PREFIX}/user-feedback/${userFeedbackDeleteInput.feedbackId}`,
      };
    },
  },
];

const authTools: IQaToolDefinition[] = [
  {
    name: "muggle-remote-auth-register",
    description:
      "Create a new Muggle AI account from an email and password and start using E2E features on the free plan immediately. No browser and no human step. Use this when there is no account yet; use muggle-remote-auth-login when one already exists. The API key it returns is stored automatically, so remote tools work straight afterwards.",
    inputSchema: schemas.AuthRegisterInputSchema,
    requiresAuth: false,
    mapToUpstream: () => {
      throw new Error("LOCAL_HANDLER_ONLY");
    },
    localHandler: async (input) => {
      const authRegisterInput = input as z.infer<typeof schemas.AuthRegisterInputSchema>;
      return registerAccount(authRegisterInput.email, authRegisterInput.password);
    },
  },
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
      const authLoginInput = input as z.infer<typeof schemas.AuthLoginInputSchema>;
      const authService = getAuthService();

      const deviceCodeResponse = await authService.startDeviceCodeFlow({
        forceNewSession: authLoginInput.forceNewSession,
      });
      const waitForCompletion = authLoginInput.waitForCompletion ?? true;

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
        timeoutMs: authLoginInput.timeoutMs,
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
      const authPollInput = input as z.infer<typeof schemas.AuthPollInputSchema>;
      const authService = getAuthService();

      const deviceCode = authPollInput.deviceCode ?? authService.getPendingDeviceCode();

      if (!deviceCode) {
        return {
          error: "NO_PENDING_LOGIN",
          message: "No pending login found. Please start a new login with muggle-remote-auth-login.",
        };
      }

      const pollResult = await authService.pollDeviceCode(deviceCode);

      if (pollResult.status === DeviceCodePollStatus.Complete) {
        return {
          status: "complete",
          success: true,
          email: pollResult.email,
          message: "Login complete. You are now authenticated.",
        };
      }

      return {
        status: pollResult.status,
        message: pollResult.message,
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
 * @returns Response authPollInput.
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
      const localHandlerResult = await tool.localHandler(validatedInput);
      return {
        content: JSON.stringify(localHandlerResult, null, 2),
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
        const recommendationResponse = mapper(
          { statusCode: 200, data: {}, headers: {} },
          validatedInput,
        );
        return {
          content: JSON.stringify(recommendationResponse, null, 2),
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
