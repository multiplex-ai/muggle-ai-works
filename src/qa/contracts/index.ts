/**
 * Zod schemas/contracts for QA Gateway tools.
 */

import { z } from "zod";

// =============================================================================
// Common Schemas
// =============================================================================

/** Pagination input schema. */
export const PaginationInputSchema = z.object({
  page: z.number().int().positive().optional().describe("Page number (1-based)"),
  pageSize: z.number().int().positive().max(100).optional().describe("Number of items per page"),
});

/** ID string schema. */
export const IdSchema = z.string().min(1).describe("Unique identifier");

/** Optional workflow parameters. */
export const WorkflowParamsSchema = z
  .record(z.unknown())
  .optional()
  .describe("Optional workflow parameters for memory configuration overrides");

// =============================================================================
// Project Schemas
// =============================================================================

export const ProjectCreateInputSchema = z.object({
  projectName: z.string().min(1).max(255).describe("Name of the project"),
  description: z.string().min(1).describe("Project description"),
  url: z.string().url().describe("Target website URL to test"),
});

export const ProjectGetInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to retrieve"),
});

export const ProjectDeleteInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to delete"),
});

export const ProjectUpdateInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to update"),
  projectName: z.string().min(1).max(255).optional().describe("New project name"),
  description: z.string().optional().describe("Updated description"),
  url: z.string().url().optional().describe("Updated target URL"),
});

export const ProjectListInputSchema = PaginationInputSchema.extend({});

// =============================================================================
// PRD File Schemas
// =============================================================================

export const PrdFileUploadInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to associate the PRD file with"),
  fileName: z.string().min(1).describe("Name of the file"),
  contentBase64: z.string().min(1).describe("Base64-encoded file content"),
  contentType: z.string().optional().describe("MIME type of the file"),
});

export const PrdFileListInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to list PRD files for"),
});

export const PrdFileDeleteInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  prdFileId: IdSchema.describe("PRD file ID to delete"),
});

export const PrdFileProcessStartInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to process PRD files for"),
  name: z.string().min(1).describe("Workflow name"),
  description: z.string().min(1).describe("Description of the PRD processing workflow"),
  prdFilePath: z.string().min(1).describe("Storage path of the uploaded PRD file (from upload response)"),
  originalFileName: z.string().min(1).describe("Original file name of the PRD document"),
  url: z.string().url().describe("Target website URL for context"),
  contentChecksum: z.string().min(1).describe("SHA-256 checksum of the PRD file content (from upload response)"),
  fileSize: z.number().int().min(0).describe("Size of the PRD file in bytes (from upload response)"),
});

export const PrdFileProcessLatestRunInputSchema = z.object({
  workflowRuntimeId: IdSchema.describe("PRD processing workflow runtime ID"),
});

// =============================================================================
// Secret Schemas
// =============================================================================

export const SecretListInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to list secrets for"),
});

export const SecretCreateInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to create the secret for"),
  name: z.string().min(1).describe("Secret name/key"),
  value: z.string().min(1).describe("Secret value"),
  description: z.string().min(1).describe("Human-readable description for selection guidance"),
  source: z.enum(["user", "agent"]).optional().describe("Source of the secret: 'user' for user-provided credentials, 'agent' for agent-generated credentials"),
});

export const SecretGetInputSchema = z.object({
  secretId: IdSchema.describe("Secret ID to retrieve"),
});

export const SecretUpdateInputSchema = z.object({
  secretId: IdSchema.describe("Secret ID to update"),
  name: z.string().min(1).optional().describe("Updated secret name"),
  value: z.string().min(1).optional().describe("Updated secret value"),
  description: z.string().optional().describe("Updated description"),
});

export const SecretDeleteInputSchema = z.object({
  secretId: IdSchema.describe("Secret ID to delete"),
});

// =============================================================================
// Use Case Schemas
// =============================================================================

export const UseCaseDiscoveryMemoryGetInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to get use case discovery memory for"),
});

export const UseCaseCandidatesApproveInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  approvedCandidateIds: z.array(IdSchema).min(1).describe("IDs of candidates to approve/graduate"),
});

export const UseCaseListInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to list use cases for"),
}).merge(PaginationInputSchema);

export const UseCaseGetInputSchema = z.object({
  useCaseId: IdSchema.describe("Use case ID to retrieve"),
});

export const UseCasePromptPreviewInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to generate use case for"),
  instruction: z.string().min(1).describe("Natural language instruction describing the use case (e.g., 'As a logged-in user, I can add items to cart')"),
});

export const UseCaseCreateFromPromptsInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to create use cases for"),
  prompts: z.array(z.object({
    instruction: z.string().min(1).describe("Natural language instruction describing the use case"),
  })).min(1).describe("Array of prompts to generate use cases from"),
});

export const UseCaseUpdateFromPromptInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  useCaseId: IdSchema.describe("Use case ID to update"),
  instruction: z.string().min(1).describe("Natural language instruction to regenerate the use case from"),
});

// =============================================================================
// Test Case Schemas
// =============================================================================

export const TestCaseListInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to list test cases for"),
}).merge(PaginationInputSchema);

export const TestCaseGetInputSchema = z.object({
  testCaseId: IdSchema.describe("Test case ID to retrieve"),
});

export const TestCaseListByUseCaseInputSchema = z.object({
  useCaseId: IdSchema.describe("Use case ID to list test cases for"),
});

export const TestCaseGenerateFromPromptInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  useCaseId: IdSchema.describe("Use case ID to generate test cases for"),
  instruction: z.string().min(1).describe("Natural language instruction describing the test cases to generate"),
});

export const TestCaseCreateInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  useCaseId: IdSchema.describe("Use case ID to associate the test case with"),
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
  projectId: IdSchema.describe("Project ID to list test scripts for"),
}).merge(PaginationInputSchema);

export const TestScriptGetInputSchema = z.object({
  testScriptId: IdSchema.describe("Test script ID to retrieve"),
});

export const TestScriptListPaginatedInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to list test scripts for"),
}).merge(PaginationInputSchema);

// =============================================================================
// Workflow Schemas
// =============================================================================

export const WorkflowStartWebsiteScanInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to scan"),
  url: z.string().url().describe("Website URL to scan"),
  description: z.string().min(1).describe("Description of what to scan/discover"),
  archiveUnapproved: z.boolean().optional().describe("Whether to archive unapproved candidates before scanning"),
  workflowParams: WorkflowParamsSchema,
});

export const WorkflowListRuntimesInputSchema = z.object({
  projectId: IdSchema.optional().describe("Filter by project ID"),
});

export const WorkflowGetLatestRunInputSchema = z.object({
  workflowRuntimeId: IdSchema.describe("Workflow runtime ID"),
});

export const WorkflowStartTestCaseDetectionInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  useCaseId: IdSchema.describe("Use case ID to detect test cases for"),
  name: z.string().min(1).describe("Workflow name"),
  description: z.string().min(1).describe("Workflow description"),
  url: z.string().url().describe("Target website URL"),
  workflowParams: WorkflowParamsSchema,
});

export const WorkflowStartTestScriptGenerationInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  useCaseId: IdSchema.describe("Use case ID"),
  testCaseId: IdSchema.describe("Test case ID"),
  name: z.string().min(1).describe("Workflow name"),
  url: z.string().url().describe("Target website URL"),
  goal: z.string().min(1).describe("Test goal"),
  precondition: z.string().min(1).describe("Preconditions"),
  instructions: z.string().min(1).describe("Step-by-step instructions"),
  expectedResult: z.string().min(1).describe("Expected result"),
  workflowParams: WorkflowParamsSchema,
});

export const WorkflowGetLatestScriptGenByTestCaseInputSchema = z.object({
  testCaseId: IdSchema.describe("Test case ID"),
});

export const WorkflowStartTestScriptReplayInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  useCaseId: IdSchema.describe("Use case ID"),
  testCaseId: IdSchema.describe("Test case ID"),
  testScriptId: IdSchema.describe("Test script ID to replay"),
  name: z.string().min(1).describe("Workflow name"),
  workflowParams: WorkflowParamsSchema,
});

export const WorkflowStartTestScriptReplayBulkInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  name: z.string().min(1).describe("Workflow name"),
  intervalSec: z.number().int().describe("Interval in seconds (-1 for one-time / on-demand)"),
  useCaseId: IdSchema.optional().describe("Optional: only replay test cases under this use case"),
  namePrefix: z.string().optional().describe("Optional: prefix for generated workflow names"),
  limit: z.number().int().optional().describe("Optional: limit number of test cases to replay"),
  testCaseIds: z.array(IdSchema).optional().describe("Optional: targeted test cases to replay"),
  repeatPerTestCase: z.number().int().optional().describe("Optional: repeat count per test case"),
  workflowParams: WorkflowParamsSchema,
});

export const WorkflowGetReplayBulkBatchSummaryInputSchema = z.object({
  runBatchId: IdSchema.describe("Run batch ID"),
});

export const WorkflowCancelRunInputSchema = z.object({
  workflowRunId: IdSchema.describe("Workflow run ID to cancel"),
});

export const WorkflowCancelRuntimeInputSchema = z.object({
  workflowRuntimeId: IdSchema.describe("Workflow runtime ID to cancel"),
});

// =============================================================================
// Report Schemas
// =============================================================================

export const ProjectTestResultsSummaryInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to get test results summary for"),
});

export const ProjectTestScriptsSummaryInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to get test scripts summary for"),
});

export const ProjectTestRunsSummaryInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to get test runs summary for"),
});

export const ReportStatsSummaryInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to get report stats for"),
});

export const ReportCostQueryInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  startDateKey: z.string().optional().describe("Start date key (YYYYMMDD)"),
  endDateKey: z.string().optional().describe("End date key (YYYYMMDD)"),
  filterType: z.string().optional().describe("Filter type for cost breakdown"),
  filterIds: z.array(z.unknown()).optional().describe("Filter IDs"),
});

export const ReportPreferencesUpsertInputSchema = z.object({
  projectId: IdSchema.describe("Project ID"),
  channels: z.array(z.unknown()).describe("Delivery channels to enable"),
  emails: z.array(z.unknown()).optional().describe("Email addresses for delivery"),
  phones: z.array(z.unknown()).optional().describe("Phone numbers for SMS delivery"),
  webhookUrl: z.string().url().optional().describe("Webhook URL for delivery"),
  defaultExportFormat: z.string().optional().describe("Default export format (pdf, html, etc.)"),
});

export const ReportFinalGenerateInputSchema = z.object({
  projectId: IdSchema.describe("Project ID to generate report for"),
  exportFormat: z.enum(["pdf", "html", "markdown"]).describe("Export format for the report"),
});

// =============================================================================
// Wallet Schemas
// =============================================================================

export const WalletTopUpInputSchema = z.object({
  packageId: IdSchema.describe("Token package ID to purchase"),
  checkoutSuccessCallback: z.string().url().describe("URL to redirect to when checkout succeeds"),
  checkoutCancelCallback: z.string().url().describe("URL to redirect to when checkout is canceled"),
});

export const WalletPaymentMethodCreateSetupSessionInputSchema = z.object({
  checkoutSuccessCallback: z.string().url().describe("URL to redirect to when payment method setup succeeds"),
  checkoutCancelCallback: z.string().url().describe("URL to redirect to when payment method setup is canceled"),
});

export const WalletAutoTopUpSetPaymentMethodInputSchema = z.object({
  paymentMethodId: IdSchema.describe("Saved Stripe payment method ID (e.g., pm_xxx)"),
});

export const WalletPaymentMethodListInputSchema = z.object({});

export const WalletAutoTopUpUpdateInputSchema = z.object({
  enabled: z.boolean().describe("Whether auto top-up is enabled"),
  topUpTriggerTokenThreshold: z.number().int().min(0).describe("Token balance threshold to trigger auto top-up"),
  packageId: IdSchema.describe("Token package ID to purchase when auto top-up triggers"),
});

// =============================================================================
// Recommendation Schemas
// =============================================================================

export const RecommendScheduleInputSchema = z.object({
  projectId: IdSchema.optional().describe("Project ID for context"),
  testFrequency: z.enum(["daily", "weekly", "onDemand"]).optional().describe("Desired test frequency"),
  timezone: z.string().optional().describe("Timezone for scheduling"),
});

export const RecommendCicdSetupInputSchema = z.object({
  projectId: IdSchema.optional().describe("Project ID for context"),
  repositoryProvider: z.enum(["github", "azureDevOps", "gitlab", "other"]).optional().describe("Git repository provider"),
  cadence: z.enum(["onPullRequest", "nightly", "onDemand"]).optional().describe("CI/CD trigger cadence"),
});
