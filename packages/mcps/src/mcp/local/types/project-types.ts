/**
 * Project types for local E2E acceptance module.
 */

import type { ChildProcess } from "child_process";

import type {
  CloudMappingEntityType,
  LocalRunStatus,
  LocalRunType,
  LocalTestScriptStatus,
  LocalWorkflowFileEntityType,
  LocalWorkflowRunStatus,
} from "./enums.js";

/**
 * Cloud source information for pulled entities.
 */
export interface ICloudSource {
  /** Cloud project ID. */
  cloudProjectId: string;
  /** Cloud use case ID (optional). */
  cloudUseCaseId?: string;
  /** Cloud test case ID (optional). */
  cloudTestCaseId?: string;
}

/**
 * Local project entity.
 */
export interface ILocalProject {
  /** Project ID. */
  id: string;
  /** Project name. */
  name: string;
  /** Project description. */
  description: string;
  /** Target URL for testing. */
  url: string;
  /** Original cloud URL (before localhost rewrite). */
  originalUrl?: string;
  /** Cloud project ID (if published). */
  cloudProjectId?: string;
  /** Last published timestamp. */
  lastPublishedAt?: number;
  /** Cloud source (if pulled from cloud). */
  cloudSource?: ICloudSource;
  /** Created timestamp. */
  createdAt: number;
  /** Updated timestamp. */
  updatedAt: number;
}

/**
 * Local use case entity.
 */
export interface ILocalUseCase {
  /** Use case ID. */
  id: string;
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
  /** Created timestamp. */
  createdAt: number;
  /** Updated timestamp. */
  updatedAt: number;
}

/**
 * Use case breakdown item.
 */
export interface IUseCaseBreakdownItem {
  /** Item title. */
  title: string;
  /** Item description. */
  description: string;
}

/**
 * Local test case entity.
 */
export interface ILocalTestCase {
  /** Test case ID. */
  id: string;
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
  /** Created timestamp. */
  createdAt: number;
  /** Updated timestamp. */
  updatedAt: number;
}

/**
 * Local test script entity.
 */
export interface ILocalTestScript {
  /** Test script ID. */
  id: string;
  /** Project ID. */
  projectId: string;
  /** Use case ID. */
  useCaseId: string;
  /** Test case ID. */
  testCaseId: string;
  /** Test script name. */
  name: string;
  /** Target URL. */
  url: string;
  /** Test goal. */
  goal?: string;
  /** Description. */
  description?: string;
  /** Precondition. */
  precondition?: string;
  /** Expected result. */
  expectedResult?: string;
  /** Test script status. */
  status: LocalTestScriptStatus;
  /** Action script ID. */
  actionScriptId?: string;
  /** Action script steps. */
  actionScript?: unknown[];
  /** Created timestamp. */
  createdAt: number;
  /** Updated timestamp. */
  updatedAt: number;
}

/**
 * Local run result entity.
 */
export interface ILocalRunResult {
  /** Run ID. */
  id: string;
  /** Project ID. */
  projectId: string;
  /** Test script ID. */
  testScriptId: string;
  /** Run type. */
  runType: LocalRunType;
  /** Run status. */
  status: LocalRunStatus;
  /** Started timestamp. */
  startedAt: number;
  /** Completed timestamp. */
  completedAt?: number;
  /** Execution time in milliseconds. */
  executionTimeMs?: number;
  /** Error message. */
  errorMessage?: string;
  /** Local screenshot paths. */
  localScreenshots: string[];
  /** Action script result. */
  actionScriptResult?: unknown;
}

/**
 * Local secret entity.
 */
export interface ILocalSecret {
  /** Secret ID. */
  id: string;
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
  /** Cloud secret ID (if synced). */
  cloudSecretId?: string;
  /** Created timestamp. */
  createdAt: number;
  /** Updated timestamp. */
  updatedAt: number;
}

/**
 * Local secret metadata (without value).
 */
export interface ILocalSecretMetadata {
  /** Secret ID. */
  id: string;
  /** Project ID. */
  projectId: string;
  /** Canonical secret name. */
  secretName: string;
  /** Description. */
  description: string;
  /** Source (user or agent). */
  source?: "user" | "agent";
  /** Cloud secret ID (if synced). */
  cloudSecretId?: string;
  /** Created timestamp. */
  createdAt: number;
  /** Updated timestamp. */
  updatedAt: number;
}

/**
 * Local workflow file association.
 */
export interface ILocalWorkflowFileAssociation {
  /** Entity type. */
  entityType: LocalWorkflowFileEntityType;
  /** Entity ID. */
  entityId: string;
}

/**
 * Local workflow file entity.
 */
export interface ILocalWorkflowFile {
  /** Workflow file ID. */
  id: string;
  /** Project ID. */
  projectId: string;
  /** Filename. */
  filename: string;
  /** Description. */
  description: string;
  /** MIME type. */
  mimeType: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** Storage URL. */
  storageUrl: string;
  /** Tags. */
  tags: string[];
  /** Local file path. */
  localPath: string;
  /** Scope associations. */
  associations: ILocalWorkflowFileAssociation[];
  /** Created timestamp. */
  createdAt: number;
  /** Updated timestamp. */
  updatedAt: number;
}

/**
 * Local workflow run entity.
 */
export interface ILocalWorkflowRun {
  /** Workflow run ID. */
  id: string;
  /** Project ID. */
  projectId: string;
  /** Workflow runtime ID. */
  workflowRuntimeId: string;
  /** Owner ID. */
  ownerId: string;
  /** Status. */
  status: LocalWorkflowRunStatus;
  /** Progress percentage. */
  progress: number;
  /** Task definition. */
  taskDef: Record<string, unknown>;
  /** Studio returned result. */
  studioReturnedResult?: {
    status?: string;
    summary?: string;
    error?: string;
  };
  /** Created timestamp. */
  createdAt: number;
  /** Started timestamp. */
  startedAt?: number;
  /** Finished timestamp. */
  finishedAt?: number;
  /** Error message. */
  error?: string;
}

/**
 * Cloud ID mapping entity.
 */
export interface ICloudIdMapping {
  /** Local ID. */
  localId: string;
  /** Cloud ID. */
  cloudId: string;
  /** Entity type. */
  entityType: CloudMappingEntityType;
}

/**
 * Execution process info.
 */
export interface IExecutionProcess {
  /** Run ID. */
  runId: string;
  /** Project ID. */
  projectId: string;
  /** Entity ID (test case or script). */
  entityId: string;
  /** Run type. */
  runType: LocalRunType;
  /** Child process. */
  process: ChildProcess;
  /** Process ID. */
  pid: number;
  /** Started timestamp. */
  startedAt: number;
  /** Current status. */
  status: LocalRunStatus;
  /** Input file path. */
  inputFilePath: string;
  /** Output file path. */
  outputFilePath: string;
  /** Timeout timer. */
  timeoutTimer?: NodeJS.Timeout;
}

/**
 * Execution result.
 */
export interface IExecutionResult {
  /** Whether execution succeeded. */
  success: boolean;
  /** Status string. */
  status: string;
  /** Summary message. */
  summary: string;
  /** Error message. */
  error?: string;
  /** Action script output. */
  actionScript?: unknown;
}
