/**
 * Local storage service for managing ~/.muggle-ai/ directory.
 */

import * as fs from "fs";
import * as path from "path";

import { getConfig } from "../../../shared/config.js";
import { getLogger } from "../../../shared/logger.js";
import type {
  ISessionMetadata,
  ISessionSummary,
  ITestStep,
} from "../types/index.js";
import { SessionStatus } from "../types/index.js";

/** Default max age for sessions in days. */
const DEFAULT_SESSION_MAX_AGE_DAYS = 30;

/**
 * Service for managing local file storage.
 */
export class StorageService {
  /** Base data directory. */
  private readonly dataDir: string;
  /** Sessions directory. */
  private readonly sessionsDir: string;

  /**
   * Create a new StorageService.
   */
  constructor() {
    const config = getConfig();
    this.dataDir = config.localQa.dataDir;
    this.sessionsDir = config.localQa.sessionsDir;
  }

  /**
   * Ensure the base directories exist.
   */
  ensureDirectories(): void {
    const logger = getLogger();

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      logger.info("Created data directory", { path: this.dataDir });
    }

    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
      logger.info("Created sessions directory", { path: this.sessionsDir });
    }
  }

  /**
   * Create a new session directory.
   * @param sessionId - Unique session ID.
   * @returns Path to the session directory.
   */
  createSessionDirectory(sessionId: string): string {
    const logger = getLogger();
    this.ensureDirectories();

    const sessionDir = path.join(this.sessionsDir, sessionId);

    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.mkdirSync(path.join(sessionDir, "screenshots"), { recursive: true });
      fs.mkdirSync(path.join(sessionDir, "logs"), { recursive: true });
      logger.info("Created session directory", { sessionId: sessionId, path: sessionDir });
    }

    return sessionDir;
  }

  /**
   * Save session metadata.
   * @param metadata - Session metadata to save.
   */
  saveSessionMetadata(metadata: ISessionMetadata): void {
    const logger = getLogger();
    const sessionDir = this.createSessionDirectory(metadata.sessionId);
    const metadataPath = path.join(sessionDir, "metadata.json");

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), "utf-8");
    logger.debug("Saved session metadata", { sessionId: metadata.sessionId });
  }

  /**
   * Load session metadata.
   * @param sessionId - Session ID to load.
   * @returns Session metadata, or null if not found.
   */
  loadSessionMetadata(sessionId: string): ISessionMetadata | null {
    const logger = getLogger();
    const metadataPath = path.join(this.sessionsDir, sessionId, "metadata.json");

    if (!fs.existsSync(metadataPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(metadataPath, "utf-8");
      return JSON.parse(content) as ISessionMetadata;
    } catch (error) {
      logger.error("Failed to load session metadata", {
        sessionId: sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * List all sessions.
   * @returns Array of session IDs.
   */
  listSessions(): string[] {
    if (!fs.existsSync(this.sessionsDir)) {
      return [];
    }

    return fs.readdirSync(this.sessionsDir).filter((entry) => {
      const entryPath = path.join(this.sessionsDir, entry);
      return fs.statSync(entryPath).isDirectory();
    });
  }

  /**
   * Get the current session ID (if any).
   * @returns Current session ID, or null.
   */
  getCurrentSessionId(): string | null {
    const currentPath = path.join(this.sessionsDir, "current");

    if (!fs.existsSync(currentPath)) {
      return null;
    }

    try {
      const target = fs.readlinkSync(currentPath);
      return path.basename(target);
    } catch {
      return null;
    }
  }

  /**
   * Set the current session.
   * @param sessionId - Session ID to set as current.
   */
  setCurrentSession(sessionId: string): void {
    const logger = getLogger();
    const currentPath = path.join(this.sessionsDir, "current");
    const targetPath = path.join(this.sessionsDir, sessionId);

    if (fs.existsSync(currentPath)) {
      fs.unlinkSync(currentPath);
    }

    fs.symlinkSync(targetPath, currentPath);
    logger.info("Set current session", { sessionId: sessionId });
  }

  /**
   * Save a screenshot to the session directory.
   * @param params - Screenshot save parameters.
   */
  saveScreenshot(params: { sessionId: string; filename: string; data: Buffer }): string {
    const { sessionId, filename, data } = params;
    const logger = getLogger();
    const sessionDir = this.createSessionDirectory(sessionId);
    const screenshotPath = path.join(sessionDir, "screenshots", filename);

    fs.writeFileSync(screenshotPath, data);
    logger.debug("Saved screenshot", { sessionId: sessionId, filename: filename });

    return screenshotPath;
  }

  /**
   * Append to the results markdown file.
   * @param params - Results append parameters.
   */
  appendToResults(params: { sessionId: string; content: string }): void {
    const { sessionId, content } = params;
    const logger = getLogger();
    const sessionDir = this.createSessionDirectory(sessionId);
    const resultsPath = path.join(sessionDir, "results.md");

    fs.appendFileSync(resultsPath, content + "\n", "utf-8");
    logger.debug("Appended to results", { sessionId: sessionId });
  }

  /**
   * Get the results markdown content.
   * @param sessionId - Session ID.
   * @returns Results content, or null if not found.
   */
  getResults(sessionId: string): string | null {
    const resultsPath = path.join(this.sessionsDir, sessionId, "results.md");

    if (!fs.existsSync(resultsPath)) {
      return null;
    }

    return fs.readFileSync(resultsPath, "utf-8");
  }

  /**
   * Get the data directory path.
   * @returns Data directory path.
   */
  getDataDir(): string {
    return this.dataDir;
  }

  /**
   * Get the sessions directory path.
   * @returns Sessions directory path.
   */
  getSessionsDir(): string {
    return this.sessionsDir;
  }

  /**
   * Create a new session with metadata.
   * @param params - Session creation parameters.
   * @returns Path to the session directory.
   */
  createSession(params: {
    sessionId: string;
    targetUrl: string;
    testInstructions: string;
  }): string {
    const { sessionId, targetUrl, testInstructions } = params;
    const logger = getLogger();

    const sessionDir = this.createSessionDirectory(sessionId);

    const metadata: ISessionMetadata = {
      sessionId: sessionId,
      workflowRunId: sessionId,
      status: SessionStatus.Running,
      startTime: new Date().toISOString(),
      targetUrl: targetUrl,
      testInstructions: testInstructions,
    };

    this.saveSessionMetadata(metadata);
    this.setCurrentSession(sessionId);

    logger.info("Created session", { sessionId: sessionId, targetUrl: targetUrl });

    return sessionDir;
  }

  /**
   * Update the status of an existing session.
   * @param params - Status update parameters.
   */
  updateSessionStatus(params: { sessionId: string; status: SessionStatus }): void {
    const { sessionId, status } = params;
    const logger = getLogger();

    const metadata = this.loadSessionMetadata(sessionId);
    if (!metadata) {
      logger.warn("Session not found for status update", { sessionId: sessionId });
      return;
    }

    metadata.status = status;
    if (status === SessionStatus.Completed || status === SessionStatus.Failed) {
      metadata.endTime = new Date().toISOString();
    }

    this.saveSessionMetadata(metadata);
    logger.debug("Updated session status", { sessionId: sessionId, status: status });
  }

  /**
   * Initialize the results.md file with a header.
   * @param params - Initialization parameters.
   */
  initializeResults(params: {
    sessionId: string;
    targetUrl: string;
    testInstructions: string;
  }): void {
    const { sessionId, targetUrl, testInstructions } = params;
    const logger = getLogger();
    const sessionDir = this.createSessionDirectory(sessionId);
    const resultsPath = path.join(sessionDir, "results.md");

    const header = [
      `# Test Results: ${sessionId}`,
      "",
      `**Target URL:** ${targetUrl}`,
      `**Started:** ${new Date().toISOString()}`,
      `**Instructions:** ${testInstructions}`,
      "",
      "---",
      "",
      "## Test Steps",
      "",
    ].join("\n");

    fs.writeFileSync(resultsPath, header, "utf-8");
    logger.debug("Initialized results.md", { sessionId: sessionId });
  }

  /**
   * Append a test step to the results.md file.
   * @param params - Step parameters.
   */
  appendStepToResults(params: { sessionId: string; step: ITestStep }): void {
    const { sessionId, step } = params;
    const logger = getLogger();
    const sessionDir = this.createSessionDirectory(sessionId);
    const resultsPath = path.join(sessionDir, "results.md");

    const statusIcon = step.success ? "✓" : "✗";
    const stepContent = [
      `### Step ${step.stepNumber}: ${step.action}`,
      "",
      step.target ? `- **Target:** ${step.target}` : "",
      `- **Result:** ${step.result} ${statusIcon}`,
      step.screenshotPath
        ? `- **Screenshot:** [step-${String(step.stepNumber).padStart(3, "0")}.png](screenshots/step-${String(step.stepNumber).padStart(3, "0")}.png)`
        : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    fs.appendFileSync(resultsPath, stepContent + "\n", "utf-8");
    logger.debug("Appended step to results", { sessionId: sessionId, stepNumber: step.stepNumber });

    const metadata = this.loadSessionMetadata(sessionId);
    if (metadata) {
      metadata.stepsCount = (metadata.stepsCount ?? 0) + 1;
      this.saveSessionMetadata(metadata);
    }
  }

  /**
   * Finalize the results.md file with a summary.
   * @param params - Finalization parameters.
   */
  finalizeResults(params: { sessionId: string; status: SessionStatus; summary?: string }): void {
    const { sessionId, status, summary } = params;
    const logger = getLogger();
    const sessionDir = path.join(this.sessionsDir, sessionId);
    const resultsPath = path.join(sessionDir, "results.md");

    if (!fs.existsSync(resultsPath)) {
      logger.warn("Results file not found for finalization", { sessionId: sessionId });
      return;
    }

    const metadata = this.loadSessionMetadata(sessionId);
    const endTime = new Date();
    const startTime = metadata?.startTime ? new Date(metadata.startTime) : endTime;
    const durationMs = endTime.getTime() - startTime.getTime();
    const durationSeconds = (durationMs / 1000).toFixed(2);

    const statusDisplay =
      status === SessionStatus.Completed
        ? "✓ Passed"
        : status === SessionStatus.Failed
          ? "✗ Failed"
          : "— Running";

    const footer = [
      "",
      "---",
      "",
      "## Summary",
      "",
      `**Status:** ${statusDisplay}`,
      `**Duration:** ${durationSeconds}s`,
      `**Steps:** ${metadata?.stepsCount ?? 0}`,
      `**Completed:** ${endTime.toISOString()}`,
      "",
      summary ? summary : "",
    ].join("\n");

    fs.appendFileSync(resultsPath, footer, "utf-8");
    logger.debug("Finalized results.md", { sessionId: sessionId, status: status });

    if (metadata) {
      metadata.durationMs = durationMs;
      metadata.endTime = endTime.toISOString();
      metadata.status = status;
      this.saveSessionMetadata(metadata);
    }
  }

  /**
   * List all sessions with their metadata.
   * @returns Array of session summaries.
   */
  listSessionsWithMetadata(): ISessionSummary[] {
    const sessionIds = this.listSessions();
    const summaries: ISessionSummary[] = [];

    for (const sessionId of sessionIds) {
      if (sessionId === "current") {
        continue;
      }

      const metadata = this.loadSessionMetadata(sessionId);
      if (metadata) {
        summaries.push({
          sessionId: metadata.sessionId,
          status: metadata.status,
          startTime: metadata.startTime,
          endTime: metadata.endTime,
          targetUrl: metadata.targetUrl,
          durationMs: metadata.durationMs,
          stepsCount: metadata.stepsCount,
        });
      }
    }

    summaries.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    return summaries;
  }

  /**
   * Cleanup old sessions beyond the specified age.
   * @param params - Cleanup parameters.
   * @returns Number of sessions deleted.
   */
  cleanupOldSessions(params?: { maxAgeDays?: number }): number {
    const maxAgeDays = params?.maxAgeDays ?? DEFAULT_SESSION_MAX_AGE_DAYS;
    const logger = getLogger();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

    const sessionIds = this.listSessions();
    let deletedCount = 0;

    for (const sessionId of sessionIds) {
      if (sessionId === "current") {
        continue;
      }

      const metadata = this.loadSessionMetadata(sessionId);
      if (!metadata) {
        continue;
      }

      const sessionDate = new Date(metadata.startTime);
      if (sessionDate < cutoffDate) {
        const sessionDir = path.join(this.sessionsDir, sessionId);
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
          deletedCount++;
          logger.info("Deleted old session", {
            sessionId: sessionId,
            age: Math.floor((Date.now() - sessionDate.getTime()) / (1000 * 60 * 60 * 24)),
          });
        } catch (error) {
          logger.error("Failed to delete session", {
            sessionId: sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (deletedCount > 0) {
      logger.info("Session cleanup completed", {
        deletedCount: deletedCount,
        maxAgeDays: maxAgeDays,
      });
    }

    return deletedCount;
  }

  /**
   * Get a session directory path.
   * @param sessionId - Session ID.
   * @returns Session directory path.
   */
  getSessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, sessionId);
  }

  /**
   * Delete a specific session.
   * @param sessionId - Session ID to delete.
   * @returns Whether deletion succeeded.
   */
  deleteSession(sessionId: string): boolean {
    const logger = getLogger();
    const sessionDir = path.join(this.sessionsDir, sessionId);

    if (!fs.existsSync(sessionDir)) {
      logger.warn("Session not found for deletion", { sessionId: sessionId });
      return false;
    }

    try {
      const currentId = this.getCurrentSessionId();
      if (currentId === sessionId) {
        const currentPath = path.join(this.sessionsDir, "current");
        if (fs.existsSync(currentPath)) {
          fs.unlinkSync(currentPath);
        }
      }

      fs.rmSync(sessionDir, { recursive: true, force: true });
      logger.info("Deleted session", { sessionId: sessionId });
      return true;
    } catch (error) {
      logger.error("Failed to delete session", {
        sessionId: sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

/** Cached service instance. */
let serviceInstance: StorageService | null = null;

/**
 * Get the singleton StorageService instance.
 * @returns StorageService instance.
 */
export function getStorageService(): StorageService {
  serviceInstance ??= new StorageService();
  return serviceInstance;
}

/**
 * Reset the service (for testing).
 */
export function resetStorageService(): void {
  serviceInstance = null;
}
