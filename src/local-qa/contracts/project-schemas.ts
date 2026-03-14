/**
 * Zod schemas for project-related tools.
 */

import { z } from "zod";

/**
 * Project create input schema.
 */
export const ProjectCreateInputSchema = z.object({
  name: z.string().min(1).describe("Name of the project"),
  description: z.string().min(1).describe("Description of the project"),
  url: z.string().url().describe("Target URL to test (e.g., http://localhost:3000)"),
});

export type ProjectCreateInput = z.infer<typeof ProjectCreateInputSchema>;

/**
 * Project ID input schema.
 */
export const ProjectIdInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
});

export type ProjectIdInput = z.infer<typeof ProjectIdInputSchema>;

/**
 * Project update input schema.
 */
export const ProjectUpdateInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID to update"),
  name: z.string().min(1).optional().describe("New project name"),
  description: z.string().min(1).optional().describe("New project description"),
  url: z.string().url().optional().describe("New target URL"),
});

export type ProjectUpdateInput = z.infer<typeof ProjectUpdateInputSchema>;

/**
 * Use case save input schema.
 */
export const UseCaseSaveInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID to save the use case under"),
  useCase: z.object({
    title: z.string().min(1).describe("Use case title"),
    userStory: z.string().optional().describe("User story description"),
    description: z.string().optional().describe("Detailed description"),
    breakdownItems: z.array(z.object({
      title: z.string(),
      description: z.string(),
    })).optional().describe("Breakdown steps"),
  }).describe("Use case data from preview API"),
});

export type UseCaseSaveInput = z.infer<typeof UseCaseSaveInputSchema>;

/**
 * Use case get input schema.
 */
export const UseCaseGetInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  useCaseId: z.string().min(1).describe("Use case ID to retrieve"),
});

export type UseCaseGetInput = z.infer<typeof UseCaseGetInputSchema>;

/**
 * Use case list input schema.
 */
export const UseCaseListInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID to list use cases for"),
});

export type UseCaseListInput = z.infer<typeof UseCaseListInputSchema>;

/**
 * Use case update input schema.
 */
export const UseCaseUpdateInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  useCaseId: z.string().min(1).describe("Use case ID to update"),
  title: z.string().min(1).optional().describe("Updated use case title"),
  userStory: z.string().optional().describe("Updated user story description"),
  description: z.string().optional().describe("Updated detailed description"),
  breakdownItems: z.array(z.object({
    title: z.string(),
    description: z.string(),
  })).optional().describe("Updated breakdown steps"),
});

export type UseCaseUpdateInput = z.infer<typeof UseCaseUpdateInputSchema>;

/**
 * Use case delete input schema.
 */
export const UseCaseDeleteInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  useCaseId: z.string().min(1).describe("Use case ID to delete"),
});

export type UseCaseDeleteInput = z.infer<typeof UseCaseDeleteInputSchema>;

/**
 * Test case save input schema.
 */
export const TestCaseSaveInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  useCaseId: z.string().min(1).describe("Use case ID to save the test case under"),
  testCase: z.object({
    title: z.string().min(1).describe("Test case title"),
    description: z.string().min(1).describe("Test case description"),
    goal: z.string().min(1).describe("Test goal"),
    precondition: z.string().optional().describe("Preconditions required"),
    instructions: z.string().optional().describe("Step-by-step instructions"),
    expectedResult: z.string().min(1).describe("Expected result"),
    url: z.string().url().describe("Target URL for the test"),
  }).describe("Test case data"),
});

export type TestCaseSaveInput = z.infer<typeof TestCaseSaveInputSchema>;

/**
 * Test case get input schema.
 */
export const TestCaseGetInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  testCaseId: z.string().min(1).describe("Test case ID to retrieve"),
});

export type TestCaseGetInput = z.infer<typeof TestCaseGetInputSchema>;

/**
 * Test case list input schema.
 */
export const TestCaseListInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  useCaseId: z.string().optional().describe("Optional use case ID to filter by"),
});

export type TestCaseListInput = z.infer<typeof TestCaseListInputSchema>;

/**
 * Test case update input schema.
 */
export const TestCaseUpdateInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  testCaseId: z.string().min(1).describe("Test case ID to update"),
  title: z.string().min(1).optional().describe("Updated test case title"),
  description: z.string().optional().describe("Updated test case description"),
  goal: z.string().optional().describe("Updated test goal"),
  precondition: z.string().optional().describe("Updated preconditions"),
  instructions: z.string().optional().describe("Updated step-by-step instructions"),
  expectedResult: z.string().optional().describe("Updated expected result"),
  url: z.string().url().optional().describe("Updated target URL for the test"),
});

export type TestCaseUpdateInput = z.infer<typeof TestCaseUpdateInputSchema>;

/**
 * Test case delete input schema.
 */
export const TestCaseDeleteInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  testCaseId: z.string().min(1).describe("Test case ID to delete"),
});

export type TestCaseDeleteInput = z.infer<typeof TestCaseDeleteInputSchema>;

/**
 * Test script save input schema.
 */
export const TestScriptSaveInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  useCaseId: z.string().min(1).describe("Use case ID"),
  testCaseId: z.string().min(1).describe("Test case ID the script was generated from"),
  testScript: z.object({
    name: z.string().min(1).describe("Test script name"),
    url: z.string().url().describe("Target URL for the test"),
    goal: z.string().optional().describe("Test goal"),
    description: z.string().optional().describe("Test description"),
    precondition: z.string().optional().describe("Test precondition"),
    expectedResult: z.string().optional().describe("Expected result"),
    actionScriptId: z.string().optional().describe("Firebase action script ID"),
    actionScript: z.array(z.unknown()).optional().describe("Action script steps"),
  }).describe("Test script data"),
});

export type TestScriptSaveInput = z.infer<typeof TestScriptSaveInputSchema>;

/**
 * Test script get input schema.
 */
export const TestScriptGetInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  testScriptId: z.string().min(1).describe("Test script ID to retrieve"),
});

export type TestScriptGetInput = z.infer<typeof TestScriptGetInputSchema>;

/**
 * Test script list input schema.
 */
export const TestScriptListInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  testCaseId: z.string().optional().describe("Optional test case ID to filter by"),
});

export type TestScriptListInput = z.infer<typeof TestScriptListInputSchema>;

/**
 * Test script delete input schema.
 */
export const TestScriptDeleteInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  testScriptId: z.string().min(1).describe("Test script ID to delete"),
});

export type TestScriptDeleteInput = z.infer<typeof TestScriptDeleteInputSchema>;

/**
 * Run result list input schema.
 */
export const RunResultListInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  testScriptId: z.string().optional().describe("Optional test script ID to filter by"),
  limit: z.number().int().positive().optional().describe("Maximum results to return (default: 20)"),
});

export type RunResultListInput = z.infer<typeof RunResultListInputSchema>;

/**
 * Run result get input schema.
 */
export const RunResultGetInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  runId: z.string().min(1).describe("Run result ID to retrieve"),
});

export type RunResultGetInput = z.infer<typeof RunResultGetInputSchema>;

/**
 * Execute test generation input schema.
 */
export const ExecuteTestGenerationInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID containing the test case"),
  testCaseId: z.string().min(1).describe("Test case ID to generate a test script for"),
  approveElectronAppLaunch: z.boolean().describe("Set to true after the user explicitly approves launching electron-app"),
  timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds (default: 300000 = 5 min)"),
});

export type ExecuteTestGenerationInput = z.infer<typeof ExecuteTestGenerationInputSchema>;

/**
 * Execute replay input schema.
 */
export const ExecuteReplayInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  testScriptId: z.string().min(1).describe("Test script ID to replay"),
  approveElectronAppLaunch: z.boolean().describe("Set to true after the user explicitly approves launching electron-app"),
  timeoutMs: z.number().int().positive().optional().describe("Timeout in milliseconds (default: 180000 = 3 min)"),
});

export type ExecuteReplayInput = z.infer<typeof ExecuteReplayInputSchema>;

/**
 * Cancel execution input schema.
 */
export const CancelExecutionInputSchema = z.object({
  runId: z.string().min(1).describe("Run ID to cancel"),
});

export type CancelExecutionInput = z.infer<typeof CancelExecutionInputSchema>;

/**
 * Secret create input schema.
 */
export const SecretCreateInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  secretName: z.string().min(1).describe("Canonical secret name"),
  value: z.string().min(1).describe("Secret value"),
  description: z.string().min(1).describe("Human-readable secret description"),
  source: z.enum(["agent", "user"]).optional().describe("Secret source"),
});

export type SecretCreateInput = z.infer<typeof SecretCreateInputSchema>;

/**
 * Secret get input schema.
 */
export const SecretGetInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  secretId: z.string().min(1).describe("Secret ID"),
});

export type SecretGetInput = z.infer<typeof SecretGetInputSchema>;

/**
 * Secret list input schema.
 */
export const SecretListInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
});

export type SecretListInput = z.infer<typeof SecretListInputSchema>;

/**
 * Secret update input schema.
 */
export const SecretUpdateInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  secretId: z.string().min(1).describe("Secret ID"),
  secretName: z.string().min(1).optional().describe("Updated canonical secret name"),
  value: z.string().min(1).optional().describe("Updated secret value"),
  description: z.string().min(1).optional().describe("Updated human-readable description"),
  source: z.enum(["agent", "user"]).optional().describe("Updated secret source"),
});

export type SecretUpdateInput = z.infer<typeof SecretUpdateInputSchema>;

/**
 * Secret delete input schema.
 */
export const SecretDeleteInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  secretId: z.string().min(1).describe("Secret ID"),
});

export type SecretDeleteInput = z.infer<typeof SecretDeleteInputSchema>;

/**
 * Publish project input schema.
 */
export const PublishProjectInputSchema = z.object({
  projectId: z.string().min(1).describe("Local project ID to publish"),
  cloudProjectId: z.string().optional().describe("Existing cloud project ID to update. If not provided, creates a new project."),
  targetUrl: z.string().url().optional().describe("Production URL to update the project with"),
});

export type PublishProjectInput = z.infer<typeof PublishProjectInputSchema>;

/**
 * Publish test script input schema.
 */
export const PublishTestScriptInputSchema = z.object({
  projectId: z.string().min(1).describe("Local project ID"),
  testScriptId: z.string().min(1).describe("Local test script ID to publish"),
  cloudProjectId: z.string().min(1).describe("Cloud project ID where the test script will be published"),
  cloudUseCaseId: z.string().min(1).describe("Cloud use case ID"),
  cloudTestCaseId: z.string().min(1).describe("Cloud test case ID"),
});

export type PublishTestScriptInput = z.infer<typeof PublishTestScriptInputSchema>;

// ========================================
// Local Workflow File Schemas
// ========================================

/**
 * Workflow file association schema.
 */
export const WorkflowFileAssociationSchema = z.object({
  entityType: z.enum(["project", "use_case", "test_case"]).describe("Scope entity type"),
  entityId: z.string().min(1).describe("Scope entity ID"),
});

/**
 * Workflow file create input schema.
 */
export const WorkflowFileCreateInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  filePath: z.string().min(1).describe("Local source file path"),
  description: z.string().min(1).describe("Workflow file description"),
  tags: z.array(z.string()).optional().describe("Workflow file tags"),
  associations: z.array(WorkflowFileAssociationSchema).optional().describe("Workflow file scope associations"),
});

export type WorkflowFileCreateInput = z.infer<typeof WorkflowFileCreateInputSchema>;

/**
 * Workflow file list input schema.
 */
export const WorkflowFileListInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
});

export type WorkflowFileListInput = z.infer<typeof WorkflowFileListInputSchema>;

/**
 * Workflow file list available input schema.
 */
export const WorkflowFileListAvailableInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  entityType: z.enum(["project", "use_case", "test_case"]).describe("Scope entity type"),
  entityId: z.string().min(1).describe("Scope entity ID"),
});

export type WorkflowFileListAvailableInput = z.infer<typeof WorkflowFileListAvailableInputSchema>;

/**
 * Workflow file get input schema.
 */
export const WorkflowFileGetInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  fileId: z.string().min(1).describe("Workflow file ID"),
});

export type WorkflowFileGetInput = z.infer<typeof WorkflowFileGetInputSchema>;

/**
 * Workflow file update input schema.
 */
export const WorkflowFileUpdateInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  fileId: z.string().min(1).describe("Workflow file ID"),
  description: z.string().min(1).optional().describe("Updated workflow file description"),
  tags: z.array(z.string()).optional().describe("Updated workflow file tags"),
  associations: z.array(WorkflowFileAssociationSchema).optional().describe("Updated scope associations"),
});

export type WorkflowFileUpdateInput = z.infer<typeof WorkflowFileUpdateInputSchema>;

/**
 * Workflow file delete input schema.
 */
export const WorkflowFileDeleteInputSchema = z.object({
  projectId: z.string().min(1).describe("Project ID"),
  fileId: z.string().min(1).describe("Workflow file ID"),
});

export type WorkflowFileDeleteInput = z.infer<typeof WorkflowFileDeleteInputSchema>;

// ========================================
// Cloud Project Schemas
// ========================================

/**
 * Cloud project list input schema (empty - uses auth to determine user).
 */
export const CloudProjectListInputSchema = z.object({});

export type CloudProjectListInput = z.infer<typeof CloudProjectListInputSchema>;

/**
 * Cloud pull project input schema.
 */
export const CloudPullProjectInputSchema = z.object({
  cloudProjectId: z.string().min(1).describe("Cloud project ID to pull"),
  localUrl: z.string().url().describe("Local URL to use for testing (e.g., http://localhost:3000)"),
});

export type CloudPullProjectInput = z.infer<typeof CloudPullProjectInputSchema>;

/**
 * Cloud pull use case input schema.
 */
export const CloudPullUseCaseInputSchema = z.object({
  cloudProjectId: z.string().min(1).describe("Cloud project ID"),
  cloudUseCaseId: z.string().min(1).describe("Cloud use case ID to pull"),
  localProjectId: z.string().min(1).describe("Local project ID to save under"),
  localUrl: z.string().url().describe("Local URL to use for testing"),
});

export type CloudPullUseCaseInput = z.infer<typeof CloudPullUseCaseInputSchema>;

/**
 * Cloud pull test case input schema.
 */
export const CloudPullTestCaseInputSchema = z.object({
  cloudProjectId: z.string().min(1).describe("Cloud project ID"),
  cloudUseCaseId: z.string().min(1).describe("Cloud use case ID"),
  cloudTestCaseId: z.string().min(1).describe("Cloud test case ID to pull"),
  localProjectId: z.string().min(1).describe("Local project ID to save under"),
  localUseCaseId: z.string().min(1).describe("Local use case ID to save under"),
  localUrl: z.string().url().describe("Local URL to use for testing"),
});

export type CloudPullTestCaseInput = z.infer<typeof CloudPullTestCaseInputSchema>;

// ========================================
// Cloud Secret Schemas
// ========================================

/**
 * Cloud secret create input schema.
 */
export const CloudSecretCreateInputSchema = z.object({
  projectId: z.string().min(1).describe("Cloud project ID"),
  secretName: z.string().min(1).describe("Canonical secret name"),
  value: z.string().min(1).describe("Secret value"),
  description: z.string().min(1).describe("Secret description"),
  source: z.enum(["agent", "user"]).optional().describe("Secret source"),
});

export type CloudSecretCreateInput = z.infer<typeof CloudSecretCreateInputSchema>;

/**
 * Cloud secret list input schema.
 */
export const CloudSecretListInputSchema = z.object({
  projectId: z.string().min(1).describe("Cloud project ID"),
});

export type CloudSecretListInput = z.infer<typeof CloudSecretListInputSchema>;

/**
 * Cloud secret get input schema.
 */
export const CloudSecretGetInputSchema = z.object({
  secretId: z.string().min(1).describe("Cloud secret ID"),
});

export type CloudSecretGetInput = z.infer<typeof CloudSecretGetInputSchema>;

/**
 * Cloud secret update input schema.
 */
export const CloudSecretUpdateInputSchema = z.object({
  secretId: z.string().min(1).describe("Cloud secret ID"),
  projectId: z.string().min(1).describe("Cloud project ID"),
  secretName: z.string().min(1).optional().describe("Updated canonical secret name"),
  value: z.string().min(1).optional().describe("Updated secret value"),
  description: z.string().min(1).optional().describe("Updated description"),
  source: z.enum(["agent", "user"]).optional().describe("Updated secret source"),
});

export type CloudSecretUpdateInput = z.infer<typeof CloudSecretUpdateInputSchema>;

/**
 * Cloud secret delete input schema.
 */
export const CloudSecretDeleteInputSchema = z.object({
  secretId: z.string().min(1).describe("Cloud secret ID"),
});

export type CloudSecretDeleteInput = z.infer<typeof CloudSecretDeleteInputSchema>;

// ========================================
// Cloud Workflow File Schemas
// ========================================

/**
 * Cloud workflow file create input schema.
 */
export const CloudWorkflowFileCreateInputSchema = z.object({
  projectId: z.string().min(1).describe("Cloud project ID"),
  filePath: z.string().min(1).describe("Local file path to upload"),
  description: z.string().min(1).describe("Workflow file description"),
  tags: z.array(z.string()).optional().describe("Workflow file tags"),
  associations: z.array(WorkflowFileAssociationSchema).optional().describe("Workflow file scope associations"),
});

export type CloudWorkflowFileCreateInput = z.infer<typeof CloudWorkflowFileCreateInputSchema>;

/**
 * Cloud workflow file list input schema.
 */
export const CloudWorkflowFileListInputSchema = z.object({
  projectId: z.string().min(1).describe("Cloud project ID"),
});

export type CloudWorkflowFileListInput = z.infer<typeof CloudWorkflowFileListInputSchema>;

/**
 * Cloud workflow file list available input schema.
 */
export const CloudWorkflowFileListAvailableInputSchema = z.object({
  projectId: z.string().min(1).describe("Cloud project ID"),
  entityType: z.enum(["project", "use_case", "test_case"]).describe("Scope entity type"),
  entityId: z.string().min(1).describe("Scope entity ID"),
});

export type CloudWorkflowFileListAvailableInput = z.infer<typeof CloudWorkflowFileListAvailableInputSchema>;

/**
 * Cloud workflow file get input schema.
 */
export const CloudWorkflowFileGetInputSchema = z.object({
  fileId: z.string().min(1).describe("Cloud workflow file ID"),
});

export type CloudWorkflowFileGetInput = z.infer<typeof CloudWorkflowFileGetInputSchema>;

/**
 * Cloud workflow file update input schema.
 */
export const CloudWorkflowFileUpdateInputSchema = z.object({
  fileId: z.string().min(1).describe("Cloud workflow file ID"),
  description: z.string().min(1).optional().describe("Updated description"),
  tags: z.array(z.string()).optional().describe("Updated tags"),
  associations: z.array(WorkflowFileAssociationSchema).optional().describe("Updated scope associations"),
});

export type CloudWorkflowFileUpdateInput = z.infer<typeof CloudWorkflowFileUpdateInputSchema>;

/**
 * Cloud workflow file delete input schema.
 */
export const CloudWorkflowFileDeleteInputSchema = z.object({
  fileId: z.string().min(1).describe("Cloud workflow file ID"),
});

export type CloudWorkflowFileDeleteInput = z.infer<typeof CloudWorkflowFileDeleteInputSchema>;

// ========================================
// Test Execution Schemas (Web Service Based)
// ========================================

/**
 * Run test input schema.
 */
export const RunTestInputSchema = z.object({
  url: z.string().url().describe("Target URL to test (supports localhost)"),
  instructions: z.string().describe("Natural language test instructions"),
  timeout_ms: z.number().optional().describe("Maximum execution time in milliseconds (default: 120000)"),
  capture_screenshots: z.boolean().optional().describe("Whether to capture screenshots during test (default: true)"),
});

export type RunTestInput = z.infer<typeof RunTestInputSchema>;

/**
 * Explore page input schema.
 */
export const ExplorePageInputSchema = z.object({
  url: z.string().url().describe("Target URL to explore"),
  analysis_depth: z.enum(["quick", "standard", "detailed"]).optional().describe("Depth of page analysis (default: standard)"),
});

export type ExplorePageInput = z.infer<typeof ExplorePageInputSchema>;

/**
 * Execute action input schema.
 */
export const ExecuteActionInputSchema = z.object({
  action_type: z.enum(["click", "type", "select", "scroll", "navigate", "wait"]).describe("Type of browser action to execute"),
  target: z.string().optional().describe("Element selector or description for click/type/select actions"),
  value: z.string().optional().describe("Text to type or option to select"),
  url: z.string().url().optional().describe("URL to navigate to (for navigate action)"),
  duration_ms: z.number().optional().describe("Wait duration in milliseconds (for wait action)"),
});

export type ExecuteActionInput = z.infer<typeof ExecuteActionInputSchema>;

/**
 * Get screenshot input schema.
 */
export const GetScreenshotInputSchema = z.object({
  execution_id: z.string().optional().describe("Specific execution ID to capture (uses current if not provided)"),
  full_page: z.boolean().optional().describe("Whether to capture the full scrollable page (default: false)"),
});

export type GetScreenshotInput = z.infer<typeof GetScreenshotInputSchema>;

/**
 * Get page state input schema.
 */
export const GetPageStateInputSchema = z.object({
  executionId: z.string().optional().describe("Optional execution ID. If not provided, uses the current active execution."),
});

export type GetPageStateInput = z.infer<typeof GetPageStateInputSchema>;
