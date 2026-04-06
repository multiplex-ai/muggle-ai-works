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

import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { getLogger } from "../../../shared/logger.js";

import type {
  ILocalExecutionContext,
  IRunResult,
  IRunResultStorageTestScript,
  RunResultType,
} from "../types/run-result-storage-types.js";

import { getStorageService } from "./storage-service.js";

const logger = getLogger();

export type {
  ILocalExecutionContext,
  IRunResult,
  IRunResultStorageTestScript,
  RunResultStatus,
  RunResultType,
  TestScriptStatus,
} from "../types/run-result-storage-types.js";

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
    const id = randomUUID();

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
  listTestScripts(): IRunResultStorageTestScript[] {
    try {
      const files = fs.readdirSync(this.testScriptsDir).filter((f) => f.endsWith(".json"));
      const scripts: IRunResultStorageTestScript[] = [];

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(this.testScriptsDir, file), "utf-8");
          scripts.push(JSON.parse(content) as IRunResultStorageTestScript);
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
  getTestScript(testScriptId: string): IRunResultStorageTestScript | undefined {
    const filePath = path.join(this.testScriptsDir, `${testScriptId}.json`);
    if (!fs.existsSync(filePath)) {
      return undefined;
    }

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as IRunResultStorageTestScript;
    } catch {
      return undefined;
    }
  }

  /**
   * Save a test script.
   */
  saveTestScript(script: IRunResultStorageTestScript): void {
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
  }): IRunResultStorageTestScript {
    const now = new Date().toISOString();
    const id = randomUUID();

    const script: IRunResultStorageTestScript = {
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
  updateTestScript(
    testScriptId: string,
    updates: Partial<IRunResultStorageTestScript>,
  ): IRunResultStorageTestScript | undefined {
    const script = this.getTestScript(testScriptId);
    if (!script) {
      return undefined;
    }

    const updated: IRunResultStorageTestScript = {
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
