import type { localQa } from "@muggleai/mcp";

/** Final outcome `muggle generate --local` reports for one run. */
export enum LocalGenerateStatus {
  Passed = "passed",
  Failed = "failed",
  Cancelled = "cancelled",
  Error = "error",
}

/** Raw options Commander hands `muggle generate --local`. */
export interface ILocalGenerateCommandOptions {
  /** Run in the local Studio; the CLI has no cloud generation path. */
  local?: boolean;
  /** Cloud project the test case belongs to. */
  projectId?: string;
  /** Cloud test case to generate a script for. */
  testCaseId?: string;
  /** Run the studio's prediction agent on the light tier. */
  light?: boolean;
  /** Show the studio window during the run. */
  showUi?: boolean;
  /** Run time limit in milliseconds, as typed. */
  timeoutMs?: string;
  /** The run's class in the local Studio line, as typed. */
  priority?: string;
  /** Print the result as one JSON line. */
  json?: boolean;
}

/** Validated arguments for one `muggle generate --local` run. */
export interface ILocalGenerateArgs {
  /** Cloud project the test case belongs to. */
  projectId: string;
  /** Cloud test case to generate a script for. */
  testCaseId: string;
  /** Run the studio's prediction agent on the light tier. */
  isLightMode: boolean;
  /** Show the studio window; a showElectronBrowser preference of always or never overrides it. */
  isUiShown: boolean;
  /** Run time limit in milliseconds; absent uses the generation default. */
  timeoutMs?: number;
  /** The run's class in the local Studio line; absent reads as internal. */
  priority?: localQa.StudioJobPriorityEnum;
  /** Print the result as one JSON line. */
  isJsonOutput: boolean;
}

/**
 * The single line `muggle generate --local --json` prints.
 *
 * Output shape: `{"status":"passed","runId":"<local run id>","testCaseId":"tc-1","actionScriptId":"as-1",
 * "testScriptId":"ts-1","durationMs":91234,"error":null}`.
 */
export interface ILocalGenerateResult {
  /** Final outcome of the run. */
  status: LocalGenerateStatus;
  /** Local run id, or null when the run never started. */
  runId: string | null;
  /** Cloud test case the run generated for. */
  testCaseId: string;
  /** Cloud action script the studio published, or null when nothing was published. */
  actionScriptId: string | null;
  /** Cloud test script the studio uploaded, or null when nothing was uploaded. */
  testScriptId: string | null;
  /** Wall time of the command in milliseconds. */
  durationMs: number;
  /** Why the run did not pass, or null. */
  error: string | null;
}

/** Cloud test case fields the generation run reads, as `muggle-remote-test-case-get` returns them. */
export interface IRemoteTestCaseRecord {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  goal?: unknown;
  expectedResult?: unknown;
  precondition?: unknown;
  instructions?: unknown;
  url?: unknown;
  projectId?: unknown;
  useCaseId?: unknown;
  displayOptions?: unknown;
  pinnedAccount?: unknown;
  alwaysStartsFreshSession?: unknown;
}
