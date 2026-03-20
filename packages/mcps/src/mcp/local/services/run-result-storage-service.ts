/**
 * Run Result Storage Service.
 *
 * Handles storage for:
 * - Run results (test generation and replay history)
 * - Locally generated test scripts
 *
 * This is a simplified storage service that only handles execution artifacts.
 * All entity management (projects, use cases, test cases) happens in the cloud.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getLogger } from "../../../shared/logger.js";

import { getStorageService } from "./storage-service.js";

const logger = getLogger();

// ========================================
// Types
// ========================================

/**
 * Run result status.
 */
export type RunResultStatus = "pending" | "running" | "passed" | "failed" | "cancelled";

/**
 * Run result type.
 */
export type RunResultType = "generation" | "replay";

/**
 * Local execution context captured during local run execution.
 */
export interface ILocalExecutionContext {
  /** URL executed locally (typically localhost). */
  originalUrl: string;
  /** Cloud production URL associated with the test case/script. */
  productionUrl: string;
  /** User ID who ran the local execution. */
  runByUserId: string;
  /** Machine hostname for the local execution environment. */
  machineHostname?: string;
  /** OS information for local execution environment. */
  osInfo?: string;
  /** Electron app version used for local execution. */
  electronAppVersion?: string;
  /** MCP server version used for local execution. */
  mcpServerVersion?: string;
  /** Local execution completion timestamp (epoch ms). */
  localExecutionCompletedAt?: number;
}

/**
 * Run result record.
 */
export interface IRunResult {
  /** Unique run ID. */
  id: string;
  /** Run type. */
  runType: RunResultType;
  /** Run status. */
  status: RunResultStatus;
  /** Cloud test case ID. */
  cloudTestCaseId: string;
  /** Cloud project ID. */
  projectId: string;
  /** Cloud use case ID. */
  useCaseId: string;
  /** Local URL used for testing. */
  localUrl: string;
  /** Cloud production URL for the same test. */
  productionUrl: string;
  /** Local execution context details. */
  localExecutionContext: ILocalExecutionContext;
  /** Associated test script ID (if generated). */
  testScriptId?: string;
  /** Path to run artifacts directory (action script, screenshots, results). */
  artifactsDir?: string;
  /** Execution time in ms. */
  executionTimeMs?: number;
  /** Error message if failed. */
  errorMessage?: string;
  /** Created timestamp. */
  createdAt: string;
  /** Updated timestamp. */
  updatedAt: string;
  /** Studio returned result (populated by electron-app after execution). */
  studioReturnedResult?: unknown;
}

/**
 * Test script status.
 */
export type TestScriptStatus = "pending" | "generated" | "published" | "failed";

/**
 * Locally generated test script.
 */
export interface ILocalTestScript {
  /** Unique script ID. */
  id: string;
  /** Script name. */
  name: string;
  /** Target URL. */
  url: string;
  /** Script status. */
  status: TestScriptStatus;
  /** Cloud test case ID. */
  cloudTestCaseId: string;
  /** Test goal. */
  goal?: string;
  /** Action script steps. */
  actionScript?: unknown[];
  /** Cloud action script ID (if published). */
  cloudActionScriptId?: string;
  /** Created timestamp. */
  createdAt: string;
  /** Updated timestamp. */
  updatedAt: string;
}

// ========================================
// Service Implementation
// ========================================

/**
 * Run Result Storage Service class.
 */
export class RunResultStorageService {
  /** Base directory for run results. */
  private readonly runResultsDir: string;

  /** Base directory for test scripts. */
  private readonly testScriptsDir: string;

  constructor() {
    const storageService = getStorageService();
    const dataDir = storageService.getDataDir();

    this.runResultsDir = path.join(dataDir, "run-results");
    this.testScriptsDir = path.join(dataDir, "test-scripts");

    this.ensureDirectories();
  }

  /**
   * Ensure storage directories exist.
   */
  private ensureDirectories(): void {
    if (!fs.existsSync(this.runResultsDir)) {
      fs.mkdirSync(this.runResultsDir, { recursive: true });
    }
    if (!fs.existsSync(this.testScriptsDir)) {
      fs.mkdirSync(this.testScriptsDir, { recursive: true });
    }
  }

  // ========================================
  // Run Results
  // ========================================

  /**
   * List all run results.
   */
  listRunResults(): IRunResult[] {
    try {
      const files = fs.readdirSync(this.runResultsDir).filter((f) => f.endsWith(".json"));
      const results: IRunResult[] = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.runResultsDir, file), "utf-8");
          results.push(JSON.parse(content) as IRunResult);
        } catch {
          logger.warn("Failed to read run result file", { file: file });
        }
      }

      // Sort by created date, newest first
      return results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch {
      return [];
    }
  }

  /**
   * Get a run result by ID.
   */
  getRunResult(runId: string): IRunResult | undefined {
    const filePath = path.join(this.runResultsDir, `${runId}.json`);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as IRunResult;
    } catch {
      return undefined;
    }
  }

  /**
   * Save a run result.
   */
  saveRunResult(result: IRunResult): void {
    const filePath = path.join(this.runResultsDir, `${result.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  }

  /**
   * Create a new run result.
   */
  createRunResult(params: {
    runType: RunResultType;
    cloudTestCaseId: string;
    projectId: string;
    useCaseId: string;
    localUrl: string;
    productionUrl: string;
    localExecutionContext: ILocalExecutionContext;
  }): IRunResult {
    const now = new Date().toISOString();
    const id = `run_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const result: IRunResult = {
      id: id,
      runType: params.runType,
      status: "pending",
      cloudTestCaseId: params.cloudTestCaseId,
      projectId: params.projectId,
      useCaseId: params.useCaseId,
      localUrl: params.localUrl,
      productionUrl: params.productionUrl,
      localExecutionContext: params.localExecutionContext,
      createdAt: now,
      updatedAt: now,
    };

    this.saveRunResult(result);
    return result;
  }

  /**
   * Update a run result.
   */
  updateRunResult(runId: string, updates: Partial<IRunResult>): IRunResult | undefined {
    const result = this.getRunResult(runId);
    if (!result) {
      return undefined;
    }

    const updated: IRunResult = {
      ...result,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.saveRunResult(updated);
    return updated;
  }

  // ========================================
  // Test Scripts
  // ========================================

  /**
   * List all test scripts.
   */
  listTestScripts(): ILocalTestScript[] {
    try {
      const files = fs.readdirSync(this.testScriptsDir).filter((f) => f.endsWith(".json"));
      const scripts: ILocalTestScript[] = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.testScriptsDir, file), "utf-8");
          scripts.push(JSON.parse(content) as ILocalTestScript);
        } catch {
          logger.warn("Failed to read test script file", { file: file });
        }
      }

      // Sort by created date, newest first
      return scripts.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch {
      return [];
    }
  }

  /**
   * Get a test script by ID.
   */
  getTestScript(testScriptId: string): ILocalTestScript | undefined {
    const filePath = path.join(this.testScriptsDir, `${testScriptId}.json`);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as ILocalTestScript;
    } catch {
      return undefined;
    }
  }

  /**
   * Save a test script.
   */
  saveTestScript(script: ILocalTestScript): void {
    const filePath = path.join(this.testScriptsDir, `${script.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(script, null, 2));
  }

  /**
   * Create a new test script.
   */
  createTestScript(params: {
    name: string;
    url: string;
    cloudTestCaseId: string;
    goal?: string;
  }): ILocalTestScript {
    const now = new Date().toISOString();
    const id = `ts_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const script: ILocalTestScript = {
      id: id,
      name: params.name,
      url: params.url,
      status: "pending",
      cloudTestCaseId: params.cloudTestCaseId,
      goal: params.goal,
      createdAt: now,
      updatedAt: now,
    };

    this.saveTestScript(script);
    return script;
  }

  /**
   * Update a test script.
   */
  updateTestScript(testScriptId: string, updates: Partial<ILocalTestScript>): ILocalTestScript | undefined {
    const script = this.getTestScript(testScriptId);
    if (!script) {
      return undefined;
    }

    const updated: ILocalTestScript = {
      ...script,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    this.saveTestScript(updated);
    return updated;
  }
}

// ========================================
// Singleton Instance
// ========================================

let instance: RunResultStorageService | null = null;

/**
 * Get the singleton RunResultStorageService instance.
 */
export function getRunResultStorageService(): RunResultStorageService {
  if (!instance) {
    instance = new RunResultStorageService();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing).
 */
export function resetRunResultStorageService(): void {
  instance = null;
}
