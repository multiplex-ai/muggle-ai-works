/** How a local website scan's Studio process ended. */
export enum WebsiteScanExitEnum {
  /** Studio finished the scan on its own and reported success. */
  Completed = "completed",
  /** The run hit its timeout and was asked to stop. */
  TimedOut = "timed_out",
  /** Studio exited with a failure, or could not be started. */
  Failed = "failed",
}

/**
 * Outcome of one local website scan's Studio process. The candidates themselves live in the
 * project's use-case discovery memory, which Studio writes as it scans.
 */
export interface IWebsiteScanExecutionResult {
  /** Local run id; the run's Studio logs are kept under the sessions directory by this id. */
  runId: string;
  /** How the Studio process ended. */
  exit: WebsiteScanExitEnum;
  /** Wall time from spawn to exit. */
  durationMs: number;
  /** Why the scan failed; null unless `exit` is Failed. */
  failureMessage: string | null;
}
