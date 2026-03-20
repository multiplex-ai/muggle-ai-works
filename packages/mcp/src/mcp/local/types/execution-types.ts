/**
 * Execution service types.
 */

import type { IExecutionProcess } from "./project-types.js";

/**
 * Studio auth info for electron-app.
 */
export interface IStudioAuthInfo {
  /** Access token. */
  accessToken: string;
  /** User email. */
  email: string;
  /** User ID. */
  userId: string;
}

/**
 * Secret option for action scripts.
 */
export interface ISecretOption {
  /** Secret ID. */
  id: string;
  /** Secret name. */
  secretName: string;
  /** Secret description. */
  description: string;
  /** Secret source. */
  source?: "agent" | "user";
}

/**
 * Workflow file metadata for action scripts.
 */
export interface IWorkflowFileMetadata {
  /** File ID. */
  id: string;
  /** File path. */
  filePath: string;
  /** File description. */
  description: string;
  /** File tags. */
  tags?: string[];
}

/**
 * Early exit info captured when process exits before waitForCompletion is called.
 */
export interface IEarlyExitInfo {
  /** Exit code from process. */
  code: number | null;
  /** Signal that terminated the process. */
  signal: NodeJS.Signals | null;
  /** Captured stdout. */
  stdout: string;
  /** Captured stderr. */
  stderr: string;
}

/**
 * Extended execution process with additional internal tracking.
 */
export interface IInternalExecutionProcess extends IExecutionProcess {
  /** Timeout timer. */
  timeoutTimer?: ReturnType<typeof setTimeout>;
  /** Inactivity check interval. */
  inactivityCheckInterval?: ReturnType<typeof setInterval>;
  /** Captured stdout from early handlers. */
  capturedStdout: string;
  /** Captured stderr from early handlers. */
  capturedStderr: string;
  /** Early exit info if process exits before waitForCompletion. */
  earlyExitInfo?: IEarlyExitInfo;
  /** Whether the process has exited. */
  hasExited: boolean;
  /** Timestamp of last output (stdout or stderr) received. */
  lastOutputAt: number;
  /** Whether the process was killed due to inactivity. */
  killedDueToInactivity: boolean;
}
