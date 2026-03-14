/**
 * Storage service parameter interfaces.
 */

import type { CloudMappingEntityType } from "./enums.js";
import type {
  ICloudIdMapping,
  ICloudSource,
  ILocalWorkflowFileAssociation,
  IUseCaseBreakdownItem,
} from "./project-types.js";

// ========================================
// Project Request Interfaces
// ========================================

/**
 * Create local project request.
 */
export interface ICreateLocalProjectRequest {
  /** Project name. */
  name: string;
  /** Project description. */
  description: string;
  /** Target URL. */
  url: string;
  /** Original URL (optional). */
  originalUrl?: string;
  /** Cloud source (optional). */
  cloudSource?: ICloudSource;
}

/**
 * Update local project request.
 */
export interface IUpdateLocalProjectRequest {
  /** Project ID. */
  id: string;
  /** New name (optional). */
  name?: string;
  /** New description (optional). */
  description?: string;
  /** New URL (optional). */
  url?: string;
  /** Original URL (optional). */
  originalUrl?: string;
  /** Cloud project ID (optional). */
  cloudProjectId?: string;
  /** Last published timestamp (optional). */
  lastPublishedAt?: number;
  /** Cloud source (optional). */
  cloudSource?: ICloudSource;
}

/**
 * Save local use case request.
 */
export interface ISaveLocalUseCaseRequest {
  /** Project ID. */
  projectId: string;
  /** Use case title. */
  title: string;
  /** User story. */
  userStory?: string;
  /** Description. */
  description?: string;
  /** Breakdown items. */
  breakdownItems?: IUseCaseBreakdownItem[];
  /** Original URL. */
  originalUrl?: string;
  /** Cloud source. */
  cloudSource?: ICloudSource;
}

/**
 * Save local test case request.
 */
export interface ISaveLocalTestCaseRequest {
  /** Project ID. */
  projectId: string;
  /** Use case ID. */
  useCaseId: string;
  /** Test case title. */
  title: string;
  /** Test case description. */
  description: string;
  /** Test goal. */
  goal: string;
  /** Precondition. */
  precondition?: string;
  /** Step-by-step instructions. */
  instructions?: string;
  /** Expected result. */
  expectedResult: string;
  /** Target URL. */
  url: string;
  /** Original URL. */
  originalUrl?: string;
  /** Cloud source. */
  cloudSource?: ICloudSource;
}

// ========================================
// Secret Params Interfaces
// ========================================

/**
 * Save local secret params.
 */
export interface ISaveLocalSecretParams {
  /** Project ID. */
  projectId: string;
  /** Canonical secret name. */
  secretName: string;
  /** Secret value. */
  value: string;
  /** Description. */
  description: string;
  /** Source (user or agent). */
  source?: "user" | "agent";
}

/**
 * Get local secret params.
 */
export interface IGetLocalSecretParams {
  /** Project ID. */
  projectId: string;
  /** Secret ID. */
  secretId: string;
}

/**
 * Update local secret params.
 */
export interface IUpdateLocalSecretParams {
  /** Project ID. */
  projectId: string;
  /** Secret ID. */
  secretId: string;
  /** Updates. */
  updates: {
    secretName?: string;
    value?: string;
    description?: string;
    source?: "user" | "agent";
    cloudSecretId?: string;
  };
}

/**
 * Delete local secret params.
 */
export interface IDeleteLocalSecretParams {
  /** Project ID. */
  projectId: string;
  /** Secret ID. */
  secretId: string;
}

// ========================================
// Workflow File Params Interfaces
// ========================================

/**
 * Save local workflow file params.
 */
export interface ISaveLocalWorkflowFileParams {
  /** Project ID. */
  projectId: string;
  /** Source file path. */
  sourceFilePath: string;
  /** Description. */
  description: string;
  /** Tags. */
  tags?: string[];
  /** Associations. */
  associations?: ILocalWorkflowFileAssociation[];
}

/**
 * Get local workflow file params.
 */
export interface IGetLocalWorkflowFileParams {
  /** Project ID. */
  projectId: string;
  /** File ID. */
  fileId: string;
}

/**
 * Update local workflow file params.
 */
export interface IUpdateLocalWorkflowFileParams {
  /** Project ID. */
  projectId: string;
  /** File ID. */
  fileId: string;
  /** Updates. */
  updates: {
    description?: string;
    tags?: string[];
    associations?: ILocalWorkflowFileAssociation[];
  };
}

/**
 * Delete local workflow file params.
 */
export interface IDeleteLocalWorkflowFileParams {
  /** Project ID. */
  projectId: string;
  /** File ID. */
  fileId: string;
}

/**
 * Resolve local workflow files params.
 */
export interface IResolveLocalWorkflowFilesParams {
  /** Project ID. */
  projectId: string;
  /** Use case ID (optional). */
  useCaseId?: string;
  /** Test case ID (optional). */
  testCaseId?: string;
}

// ========================================
// Test Artifact Params Interfaces
// ========================================

/**
 * Get local use case params.
 */
export interface IGetLocalUseCaseParams {
  /** Project ID. */
  projectId: string;
  /** Use case ID. */
  useCaseId: string;
}

/**
 * Update local use case params.
 */
export interface IUpdateLocalUseCaseParams {
  /** Project ID. */
  projectId: string;
  /** Use case ID. */
  useCaseId: string;
  /** Updates. */
  updates: {
    title?: string;
    userStory?: string;
    description?: string;
    breakdownItems?: IUseCaseBreakdownItem[];
    cloudUseCaseId?: string;
  };
}

/**
 * Delete local use case params.
 */
export interface IDeleteLocalUseCaseParams {
  /** Project ID. */
  projectId: string;
  /** Use case ID. */
  useCaseId: string;
}

/**
 * Get local test case params.
 */
export interface IGetLocalTestCaseParams {
  /** Project ID. */
  projectId: string;
  /** Test case ID. */
  testCaseId: string;
}

/**
 * List local test cases params.
 */
export interface IListLocalTestCasesParams {
  /** Project ID. */
  projectId: string;
  /** Use case ID (optional filter). */
  useCaseId?: string;
}

/**
 * Update local test case params.
 */
export interface IUpdateLocalTestCaseParams {
  /** Project ID. */
  projectId: string;
  /** Test case ID. */
  testCaseId: string;
  /** Updates. */
  updates: {
    title?: string;
    description?: string;
    goal?: string;
    precondition?: string;
    instructions?: string;
    expectedResult?: string;
    url?: string;
    cloudTestCaseId?: string;
  };
}

/**
 * Delete local test case params.
 */
export interface IDeleteLocalTestCaseParams {
  /** Project ID. */
  projectId: string;
  /** Test case ID. */
  testCaseId: string;
}

/**
 * Create local test script params.
 */
export interface ICreateLocalTestScriptParams {
  /** Project ID. */
  projectId: string;
  /** Use case ID. */
  useCaseId: string;
  /** Test case ID. */
  testCaseId: string;
  /** Target URL. */
  url: string;
  /** Test script name (optional). */
  name?: string;
  /** Test script ID (optional, for explicit ID). */
  testScriptId?: string;
}

/**
 * Get local test script params.
 */
export interface IGetLocalTestScriptParams {
  /** Project ID. */
  projectId: string;
  /** Test script ID. */
  testScriptId: string;
}

/**
 * Get local test script path params.
 */
export interface IGetLocalTestScriptPathParams {
  /** Project ID. */
  projectId: string;
  /** Test script ID. */
  testScriptId: string;
}

/**
 * List local test scripts params.
 */
export interface IListLocalTestScriptsParams {
  /** Project ID. */
  projectId: string;
  /** Test case ID (optional filter). */
  testCaseId?: string;
}

/**
 * Update local test script params.
 */
export interface IUpdateLocalTestScriptParams {
  /** Project ID. */
  projectId: string;
  /** Test script ID. */
  testScriptId: string;
  /** Updates. */
  updates: Partial<{
    name: string;
    url: string;
    goal: string;
    description: string;
    precondition: string;
    expectedResult: string;
    status: import("./enums.js").LocalTestScriptStatus;
    actionScriptId: string;
    actionScript: unknown[];
  }>;
}

/**
 * Delete local test script params.
 */
export interface IDeleteLocalTestScriptParams {
  /** Project ID. */
  projectId: string;
  /** Test script ID. */
  testScriptId: string;
}

/**
 * Save local action script params.
 */
export interface ISaveLocalActionScriptParams {
  /** Project ID. */
  projectId: string;
  /** Test script ID. */
  testScriptId: string;
  /** Action script data. */
  actionScript: unknown;
}

/**
 * Save local test script screenshot params.
 */
export interface ISaveLocalTestScriptScreenshotParams {
  /** Project ID. */
  projectId: string;
  /** Test script ID. */
  testScriptId: string;
  /** Filename. */
  filename: string;
  /** Screenshot data. */
  data: Buffer;
}

// ========================================
// Run Params Interfaces
// ========================================

/**
 * Get local run result params.
 */
export interface IGetLocalRunResultParams {
  /** Project ID. */
  projectId: string;
  /** Run ID. */
  runId: string;
}

/**
 * Update local run result params.
 */
export interface IUpdateLocalRunResultParams {
  /** Project ID. */
  projectId: string;
  /** Run ID. */
  runId: string;
  /** Updates. */
  updates: Partial<{
    status: import("./enums.js").LocalRunStatus;
    completedAt: number;
    executionTimeMs: number;
    errorMessage: string;
    localScreenshots: string[];
    actionScriptResult: unknown;
  }>;
}

/**
 * Save local run screenshot params.
 */
export interface ISaveLocalRunScreenshotParams {
  /** Project ID. */
  projectId: string;
  /** Run ID. */
  runId: string;
  /** Filename. */
  filename: string;
  /** Screenshot data. */
  data: Buffer;
}

/**
 * Get local workflow run params.
 */
export interface IGetLocalWorkflowRunParams {
  /** Project ID. */
  projectId: string;
  /** Workflow run ID. */
  workflowRunId: string;
}

/**
 * Update local workflow run params.
 */
export interface IUpdateLocalWorkflowRunParams {
  /** Project ID. */
  projectId: string;
  /** Workflow run ID. */
  workflowRunId: string;
  /** Updates. */
  updates: Partial<{
    status: import("./enums.js").LocalWorkflowRunStatus;
    progress: number;
    finishedAt: number;
    error: string;
    studioReturnedResult: {
      status?: string;
      summary?: string;
      error?: string;
    };
  }>;
}

/**
 * Save cloud ID mapping params.
 */
export interface ISaveCloudIdMappingParams {
  /** Project ID. */
  projectId: string;
  /** Mapping data. */
  mapping: ICloudIdMapping;
}

/**
 * Get cloud ID mapping params.
 */
export interface IGetCloudIdMappingParams {
  /** Project ID. */
  projectId: string;
  /** Local ID. */
  localId: string;
  /** Entity type. */
  entityType: CloudMappingEntityType;
}

/**
 * Update cloud mapping params.
 */
export interface IUpdateCloudMappingParams {
  /** Local ID. */
  localId: string;
  /** Cloud ID. */
  cloudId: string;
  /** Entity type. */
  entityType: string;
}

// ========================================
// Session Types
// ========================================

/**
 * Session metadata.
 */
export interface ISessionMetadata {
  /** Session ID. */
  sessionId: string;
  /** Workflow run ID. */
  workflowRunId: string;
  /** Session status. */
  status: string;
  /** Start time (ISO string). */
  startTime: string;
  /** End time (ISO string). */
  endTime?: string;
  /** Target URL. */
  targetUrl: string;
  /** Test instructions. */
  testInstructions?: string;
  /** Duration in milliseconds. */
  durationMs?: number;
  /** Number of steps. */
  stepsCount?: number;
}

/**
 * Session summary.
 */
export interface ISessionSummary {
  /** Session ID. */
  sessionId: string;
  /** Session status. */
  status: string;
  /** Start time (ISO string). */
  startTime: string;
  /** End time (ISO string). */
  endTime?: string;
  /** Target URL. */
  targetUrl: string;
  /** Duration in milliseconds. */
  durationMs?: number;
  /** Number of steps. */
  stepsCount?: number;
}

/**
 * Test step.
 */
export interface ITestStep {
  /** Step number. */
  stepNumber: number;
  /** Action performed. */
  action: string;
  /** Target element. */
  target?: string;
  /** Result description. */
  result: string;
  /** Whether the step succeeded. */
  success: boolean;
  /** Screenshot path. */
  screenshotPath?: string;
}

/**
 * Display params (for test script formatting).
 */
export interface IDisplayParams {
  /** Whether to show full action script. */
  showFullActionScript?: boolean;
}
