/**
 * Zod schemas/contracts for cloud E2E acceptance gateway (muggle-remote-*) tools.
 */

import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";

export { MuggleEntityIdSchema };
export * from "./local-run-schemas.js";

// =============================================================================
// Common Schemas
// =============================================================================

/**
 * Pagination input schema shared by list tools.
 *
 * The backend honors these params: a list call with no arguments returns the first
 * page of 10 items sorted by creation time (newest first). The response envelope
 * carries `totalCount`, `totalPages`, and `hasMore` so the caller can page forward
 * without guessing when to stop. Out-of-range pages return `data: []` rather than
 * erroring.
 */
export const PaginationInputSchema = z.object({
  page: z
    .number()
    .int()
    .positive()
    .default(1)
    .describe("Page number, 1-based. Defaults to 1 (the first page)."),
  pageSize: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(10)
    .describe("Number of items per page. Defaults to 10, max 100."),
  sortBy: z
    .enum(["createdAt", "updatedAt"])
    .default("createdAt")
    .describe("Field to sort by. Defaults to createdAt (stable under concurrent writes)."),
  sortOrder: z
    .enum(["asc", "desc"])
    .default("desc")
    .describe("Sort direction. Defaults to desc (newest first)."),
});

/**
 * UUID string schema for Muggle Test cloud resource IDs
 * (projects, PRD files, secrets, use cases, test cases, scripts, workflow runtimes, etc.).
 */
export const IdSchema = MuggleEntityIdSchema;

/**
 * Bulk test-script replay batch id (server assigns via randomUUID per TestScriptReplayBulkWorkflowRun).
 */
export const RunBatchIdSchema = MuggleEntityIdSchema.describe("Bulk replay run batch ID (UUID)");

/** Token package id from wallet catalog (Stripe metadata SKU; not a UUID). */
export const TokenPackageIdSchema = z.string().min(1).describe("Token package ID from wallet catalog");

/** Stripe payment method id (pm_…). */
export const StripePaymentMethodIdSchema = z
  .string()
  .regex(/^pm_[a-zA-Z0-9]+$/)
  .describe("Stripe payment method ID (pm_…)");

/**
 * API key record id from the server (24 hex chars from randomBytes(12); not a UUID).
 */
export const ApiKeyRecordIdSchema = z
  .string()
  .length(24)
  .regex(/^[0-9a-f]+$/i)
  .describe("API key record ID (24-character hex)");

/** Optional memory configuration overrides in workflow params. */
export const WorkflowMemoryParamsSchema = z.object({
  enableSharedTestMemory: z.boolean().optional().describe("Override to enable/disable SharedTestMemory for this workflow run"),
  enableEverMemOS: z.boolean().optional().describe("Override to enable/disable EverMemOS for this workflow run"),
});

/** Optional workflow parameters. */
export const WorkflowParamsSchema = z.object({
  memory: WorkflowMemoryParamsSchema.optional().describe("Per-run memory override settings"),
}).passthrough().optional().describe("Optional workflow parameters for workflow-level overrides");

/**
 * Token usage cost breakdown dimension (matches server TokenUsageFilterType).
 */
export const TokenUsageFilterTypeSchema = z.enum([
  "project",
  "useCase",
  "testCase",
  "testScript",
  "actionScript",
]).describe("Token cost aggregation dimension");

// =============================================================================
// Project Schemas
// =============================================================================

export const ProjectCreateInputSchema = z.object({
  projectName: z.string().min(1).max(255).describe("Name of the project"),
  description: z.string().min(1).describe("Project description"),
  url: z.string().url().describe("Target website URL to test"),
});

export const ProjectGetInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to retrieve"),
});

export const ProjectDeleteInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to delete"),
});

export const ProjectUpdateInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to update"),
  projectName: z.string().min(1).max(255).optional().describe("New project name"),
  description: z.string().optional().describe("Updated description"),
  url: z.string().url().optional().describe("Updated target URL"),
});

export const ProjectListInputSchema = PaginationInputSchema.extend({});

// =============================================================================
// PRD File Schemas
// =============================================================================

export const PrdFileUploadInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to associate the PRD file with"),
  fileName: z.string().min(1).describe("Name of the file"),
  contentBase64: z.string().min(1).describe("Base64-encoded file content"),
  contentType: z.string().optional().describe("MIME type of the file"),
});

export const PrdFileListInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to list PRD files for"),
});

export const PrdFileDeleteInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  prdFileId: IdSchema.describe("PRD file ID (UUID) to delete"),
});

export const PrdFileProcessStartInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to process PRD files for"),
  name: z.string().min(1).describe("Workflow name"),
  description: z.string().min(1).describe("Description of the PRD processing workflow"),
  prdFilePath: z.string().min(1).describe("Storage path of the uploaded PRD file (from upload response)"),
  originalFileName: z.string().min(1).describe("Original file name of the PRD document"),
  url: z.string().url().describe("Target website URL for context"),
  contentChecksum: z.string().min(1).describe("SHA-256 checksum of the PRD file content (from upload response)"),
  fileSize: z.number().int().min(0).describe("Size of the PRD file in bytes (from upload response)"),
});

export const PrdFileProcessLatestRunInputSchema = z.object({
  workflowRuntimeId: IdSchema.describe("PRD processing workflow runtime ID (UUID)"),
});

// =============================================================================
// Secret Schemas
// =============================================================================

export const SecretListInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to list secrets for"),
});

export const SecretCreateInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to create the secret for"),
  name: z.string().min(1).describe("Secret name/key"),
  value: z.string().min(1).describe("Secret value"),
  description: z.string().min(1).describe("Human-readable description for selection guidance"),
  source: z.enum(["user", "agent"]).optional().describe("Source of the secret: 'user' for user-provided credentials, 'agent' for agent-generated credentials"),
});

export const SecretGetInputSchema = z.object({
  secretId: IdSchema.describe("Secret ID (UUID) to retrieve"),
});

export const SecretUpdateInputSchema = z.object({
  secretId: IdSchema.describe("Secret ID (UUID) to update"),
  name: z.string().min(1).optional().describe("Updated secret name"),
  value: z.string().min(1).optional().describe("Updated secret value"),
  description: z.string().optional().describe("Updated description"),
});

export const SecretDeleteInputSchema = z.object({
  secretId: IdSchema.describe("Secret ID (UUID) to delete"),
});

// =============================================================================
// Use Case Schemas
// =============================================================================

export const UseCaseDiscoveryMemoryGetInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to get use case discovery memory for"),
});

export const UseCaseCandidatesApproveInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  approvedCandidateIds: z.array(IdSchema).min(1).describe("IDs of candidates to approve/graduate"),
});

export const UseCaseListInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to list use cases for"),
}).merge(PaginationInputSchema);

export const UseCaseGetInputSchema = z.object({
  useCaseId: IdSchema.describe("Use case ID (UUID) to retrieve"),
});

export const UseCasePromptPreviewInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to generate use case for"),
  instruction: z.string().min(1).describe("Natural language instruction describing the use case (e.g., 'As a logged-in user, I can add items to cart')"),
});

export const UseCaseCreateFromPromptsInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to create use cases for"),
  instructions: z.array(z.string().min(1)).min(1).describe("Natural-language instructions — one use case is generated per string (e.g., [\"As a user, I can log in\"])"),
});

export const UseCaseUpdateFromPromptInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  useCaseId: IdSchema.describe("Use case ID (UUID) to update"),
  instruction: z.string().min(1).describe("Natural language instruction to regenerate the use case from"),
});

/**
 * Shape of a fully-specified use case, matching IUseCaseCreationRequest on the server.
 * Used by muggle-remote-use-case-create to persist use cases returned by bulk-preview.
 */
export const UseCaseCreateInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) the use case belongs to"),
  title: z.string().min(1).describe("Use case title"),
  description: z.string().min(1).describe("Description of the use case, including actor and preconditions"),
  userStory: z.string().min(1).describe("One-line user story from the end-user point of view"),
  url: z.string().url().optional().describe("URL where the use case takes place (defaults to project URL)"),
  useCaseBreakdown: z.array(z.object({
    requirement: z.string().min(1).describe("One requirement of the use case"),
    acceptanceCriteria: z.string().min(1).describe("Concrete, measurable acceptance criteria for the requirement"),
  })).describe("Main/alternative/error flows broken down as requirement + acceptance criteria pairs"),
  status: z.enum(["DRAFT", "IN_REVIEW", "APPROVED", "IMPLEMENTED", "ARCHIVED"]).describe("Use case status"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).describe("Use case priority"),
  source: z.enum(["PRD_FILE", "SITEMAP", "CRAWLER", "PROMPT", "MANUAL"]).describe("How this use case was produced"),
  category: z.string().optional().describe("Optional category"),
});

// =============================================================================
// Bulk Preview Schemas
// =============================================================================

/** One prompt inside a bulk-preview submit request. */
export const BulkPreviewPromptSchema = z.object({
  clientRef: z.string().max(128).optional().describe("Optional caller-supplied reference echoed back on results"),
  instruction: z.string().min(1).max(4000).describe("Natural language instruction (max 4000 chars)"),
});

/** Submit a bulk-preview job that generates use cases from a batch of prompts. */
export const BulkPreviewSubmitUseCaseInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) the use cases belong to"),
  prompts: z.array(BulkPreviewPromptSchema).min(1).max(100).describe("Prompts to generate use cases from (max 100 per request)"),
});

/** Submit a bulk-preview job that generates test cases for a single use case from a batch of prompts. */
export const BulkPreviewSubmitTestCaseInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  useCaseId: IdSchema.describe("Parent use case ID (UUID) the test cases will belong to"),
  prompts: z.array(BulkPreviewPromptSchema).min(1).max(100).describe("Prompts to generate test cases from (max 100 per request)"),
});

/** Bulk-preview job status values (mirrors server BulkPreviewJobStatus). */
export const BulkPreviewJobStatusSchema = z.enum([
  "queued",
  "submitted",
  "running",
  "succeeded",
  "partial",
  "failed",
  "cancelled",
  "expired",
]);

/** Bulk-preview job kind values (mirrors server BulkPreviewJobKind). */
export const BulkPreviewJobKindSchema = z.enum(["useCase", "testCase"]);

export const BulkPreviewJobGetInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  jobId: IdSchema.describe("Bulk-preview job ID (UUID)"),
});

export const BulkPreviewJobCancelInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  jobId: IdSchema.describe("Bulk-preview job ID (UUID) to cancel"),
});

export const BulkPreviewJobListInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to list bulk-preview jobs for"),
  status: z.array(BulkPreviewJobStatusSchema).optional().describe("Optional filter — only return jobs matching any of these statuses"),
  kind: BulkPreviewJobKindSchema.optional().describe("Optional filter — only return jobs of this kind"),
  limit: z.number().int().min(1).max(100).optional().describe("Max jobs to return (default 20, max 100)"),
  cursor: z.string().optional().describe("Pagination cursor returned by a previous call"),
});

// =============================================================================
// Test Case Schemas
// =============================================================================

export const TestCaseListInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to list test cases for"),
}).merge(PaginationInputSchema);

export const TestCaseGetInputSchema = z.object({
  testCaseId: IdSchema.describe("Test case ID (UUID) to retrieve"),
});

export const TestCaseListByUseCaseInputSchema = z.object({
  useCaseId: IdSchema.describe("Use case ID (UUID) to list test cases for"),
});

export const TestCaseGenerateFromPromptInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  useCaseId: IdSchema.describe("Use case ID (UUID) to generate test cases for"),
  instruction: z.string().min(1).describe("Natural language instruction describing the test cases to generate"),
});

export const TestCaseCreateInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  useCaseId: IdSchema.describe("Use case ID (UUID) to associate the test case with"),
  title: z.string().min(1).describe("Test case title"),
  description: z.string().min(1).describe("Detailed description of what the test case validates"),
  goal: z.string().min(1).describe("Concise, measurable goal of the test"),
  precondition: z.string().optional().describe("Initial state/setup required before test execution"),
  expectedResult: z.string().min(1).describe("Expected outcome after test execution"),
  url: z.string().url().describe("Target URL for the test case"),
  status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED", "ARCHIVED"]).optional().describe("Test case status"),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional().describe("Test case priority"),
  tags: z.array(z.string()).optional().describe("Tags for categorization"),
  category: z.string().optional().describe("Test case category"),
  automated: z.boolean().optional().describe("Whether this test case is automated (default: true)"),
});

// =============================================================================
// Test Script Schemas
// =============================================================================

export const TestScriptListInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to list test scripts for"),
  testCaseId: IdSchema.optional().describe("Optional test case ID (UUID) to filter scripts by"),
}).merge(PaginationInputSchema);

export const TestScriptGetInputSchema = z.object({
  testScriptId: IdSchema.describe("Test script ID (UUID) to retrieve"),
});

// =============================================================================
// Action Script Schemas
// =============================================================================

export const ActionScriptGetInputSchema = z.object({
  actionScriptId: IdSchema.describe("Action script ID (UUID) to retrieve"),
});

// =============================================================================
// Workflow Schemas
// =============================================================================

export const WorkflowStartWebsiteScanInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to scan"),
  url: z.string().url().describe("Website URL to scan"),
  description: z.string().min(1).describe("Description of what to scan/discover"),
  archiveUnapproved: z.boolean().optional().describe("Whether to archive unapproved candidates before scanning"),
  workflowParams: WorkflowParamsSchema,
});

export const WorkflowListRuntimesInputSchema = z.object({
  projectId: IdSchema.optional().describe("Filter by project ID (UUID)"),
});

export const WorkflowGetLatestRunInputSchema = z.object({
  workflowRuntimeId: IdSchema.describe("Workflow runtime ID (UUID)"),
});

export const WorkflowStartTestCaseDetectionInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  useCaseId: IdSchema.describe("Use case ID (UUID) to detect test cases for"),
  name: z.string().min(1).describe("Workflow name"),
  description: z.string().min(1).describe("Workflow description"),
  url: z.string().url().describe("Target website URL"),
  workflowParams: WorkflowParamsSchema,
});

export const WorkflowStartTestScriptGenerationInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  useCaseId: IdSchema.describe("Use case ID (UUID)"),
  testCaseId: IdSchema.describe("Test case ID (UUID)"),
  name: z.string().min(1).describe("Workflow name"),
  url: z.string().url().describe("Target website URL"),
  goal: z.string().min(1).describe("Test goal"),
  precondition: z.string().min(1).describe("Preconditions"),
  instructions: z.string().min(1).describe("Step-by-step instructions"),
  expectedResult: z.string().min(1).describe("Expected result"),
  workflowParams: WorkflowParamsSchema,
});

export const WorkflowGetLatestScriptGenByTestCaseInputSchema = z.object({
  testCaseId: IdSchema.describe("Test case ID (UUID)"),
});

export const WorkflowStartTestScriptReplayInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  useCaseId: IdSchema.describe("Use case ID (UUID)"),
  testCaseId: IdSchema.describe("Test case ID (UUID)"),
  testScriptId: IdSchema.describe("Test script ID (UUID) to replay"),
  name: z.string().min(1).describe("Workflow name"),
  workflowParams: WorkflowParamsSchema,
});

export const WorkflowStartTestScriptReplayBulkInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  name: z.string().min(1).describe("Workflow name"),
  intervalSec: z.number().int().describe("Interval in seconds (-1 for one-time / on-demand)"),
  useCaseId: IdSchema.optional().describe("Optional: only replay test cases under this use case (UUID)"),
  namePrefix: z.string().optional().describe("Optional: prefix for generated workflow names"),
  limit: z.number().int().optional().describe("Optional: limit number of test cases to replay"),
  testCaseIds: z.array(IdSchema).optional().describe("Optional: targeted test case UUIDs to replay"),
  repeatPerTestCase: z.number().int().optional().describe("Optional: repeat count per test case"),
  workflowParams: WorkflowParamsSchema,
});

export const WorkflowGetReplayBulkBatchSummaryInputSchema = z.object({
  runBatchId: RunBatchIdSchema.describe("Run batch ID (UUID) from bulk replay workflow"),
});

export const WorkflowCancelRunInputSchema = z.object({
  workflowRunId: IdSchema.describe("Workflow run ID (UUID) to cancel"),
});

export const WorkflowCancelRuntimeInputSchema = z.object({
  workflowRuntimeId: IdSchema.describe("Workflow runtime ID (UUID) to cancel"),
});

// =============================================================================
// Report Schemas
// =============================================================================

export const ProjectTestResultsSummaryInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to get test results summary for"),
});

export const ProjectTestScriptsSummaryInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to get test scripts summary for"),
});

export const ProjectTestRunsSummaryInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to get test runs summary for"),
});

export const ReportStatsSummaryInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to get report stats for"),
});

export const ReportCostQueryInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  startDateKey: z.string().optional().describe("Start date key (YYYYMMDD)"),
  endDateKey: z.string().optional().describe("End date key (YYYYMMDD)"),
  filterType: TokenUsageFilterTypeSchema.optional().describe("Aggregation dimension for cost breakdown"),
  filterIds: z.array(IdSchema).optional().describe("Entity UUIDs matching filterType (project / use case / test case / test script / action script)"),
});

export const ReportPreferencesUpsertInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID)"),
  channels: z.array(z.unknown()).describe("Delivery channels to enable"),
  emails: z.array(z.unknown()).optional().describe("Email addresses for delivery"),
  phones: z.array(z.unknown()).optional().describe("Phone numbers for SMS delivery"),
  webhookUrl: z.string().url().optional().describe("Webhook URL for delivery"),
  defaultExportFormat: z.string().optional().describe("Default export format (pdf, html, etc.)"),
});

export const ReportFinalGenerateInputSchema = z.object({
  projectId: IdSchema.describe("Project ID (UUID) to generate report for"),
  exportFormat: z.enum(["pdf", "html", "markdown"]).describe("Export format for the report"),
});

// =============================================================================
// Wallet Schemas
// =============================================================================

export const WalletTopUpInputSchema = z.object({
  packageId: TokenPackageIdSchema.describe("Token package ID to purchase"),
  checkoutSuccessCallback: z.string().url().describe("URL to redirect to when checkout succeeds"),
  checkoutCancelCallback: z.string().url().describe("URL to redirect to when checkout is canceled"),
});

export const WalletPaymentMethodCreateSetupSessionInputSchema = z.object({
  checkoutSuccessCallback: z.string().url().describe("URL to redirect to when payment method setup succeeds"),
  checkoutCancelCallback: z.string().url().describe("URL to redirect to when payment method setup is canceled"),
});

export const WalletAutoTopUpSetPaymentMethodInputSchema = z.object({
  paymentMethodId: StripePaymentMethodIdSchema.describe("Saved Stripe payment method ID"),
});

export const WalletPaymentMethodListInputSchema = z.object({});

export const WalletAutoTopUpUpdateInputSchema = z.object({
  enabled: z.boolean().describe("Whether auto top-up is enabled"),
  topUpTriggerTokenThreshold: z.number().int().min(0).describe("Token balance threshold to trigger auto top-up"),
  packageId: TokenPackageIdSchema.describe("Token package ID to purchase when auto top-up triggers"),
});

// =============================================================================
// Recommendation Schemas
// =============================================================================

export const RecommendScheduleInputSchema = z.object({
  projectId: IdSchema.optional().describe("Project ID (UUID) for context"),
  testFrequency: z.enum(["daily", "weekly", "onDemand"]).optional().describe("Desired test frequency"),
  timezone: z.string().optional().describe("Timezone for scheduling"),
});

export const RecommendCicdSetupInputSchema = z.object({
  projectId: IdSchema.optional().describe("Project ID (UUID) for context"),
  repositoryProvider: z.enum(["github", "azureDevOps", "gitlab", "other"]).optional().describe("Git repository provider"),
  cadence: z.enum(["onPullRequest", "nightly", "onDemand"]).optional().describe("CI/CD trigger cadence"),
});

// =============================================================================
// API Key Schemas
// =============================================================================

export const ApiKeyCreateInputSchema = z.object({
  name: z.string().optional().describe("Name for the API key (helps identify the key later)"),
  expiry: z.enum(["30d", "90d", "1y", "never"]).optional().describe("Key expiry period (default: 90d)"),
});

export const ApiKeyListInputSchema = z.object({});

export const ApiKeyGetInputSchema = z.object({
  apiKeyId: ApiKeyRecordIdSchema.describe("ID of the API key record to retrieve"),
});

export const ApiKeyRevokeInputSchema = z.object({
  apiKeyId: ApiKeyRecordIdSchema.describe("ID of the API key record to revoke"),
});

// =============================================================================
// Auth Schemas (Device Code Flow)
// =============================================================================

/**
 * Auth login input schema for device code flow.
 */
export const AuthLoginInputSchema = z.object({
  waitForCompletion: z.boolean().optional().describe("Whether to wait for browser login completion before returning. Default: true"),
  timeoutMs: z.number().int().positive().min(1000).max(900000).optional().describe("Maximum time to wait for login completion in milliseconds. Default: 120000"),
});

/**
 * Auth poll input schema.
 */
export const AuthPollInputSchema = z.object({
  deviceCode: z.string().optional().describe("Device code from the login response. Optional if a login was recently started."),
});

/**
 * Empty input schema for tools that take no parameters.
 */
export const EmptyInputSchema = z.object({});
