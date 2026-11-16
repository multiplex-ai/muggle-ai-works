/**
 * Re-export service functions and classes.
 */

export { AuthService, getAuthService, resetAuthService } from "./auth-service.js";

export {
  getStorageService,
  resetStorageService,
  StorageService,
} from "./storage-service.js";

export {
  getRunResultStorageService,
  resetRunResultStorageService,
  RunResultStorageService,
} from "./run-result-storage-service.js";

export {
  cancelExecution,
  executeReplay,
  executeTestGeneration,
  executeWebsiteScan,
  listActiveExecutions,
} from "./execution-service.js";
export type { ILocalRunResult as ILocalExecutionRunResult } from "./execution-service.js";

export { DEFAULT_WEBSITE_SCAN_TIMEOUT_MS } from "./execution-timeout-constants.js";
export { WebsiteScanExitEnum } from "./website-scan-types.js";
export type { IWebsiteScanExecutionResult } from "./website-scan-types.js";

export { findRunCheckoutRefusal, isLoopbackUrl } from "./run-checkout-gate.js";

export { recordTelemetryEvent } from "./telemetry-event-service.js";

export {
  acquireLocalExecutionLock,
  readLocalExecutionLockState,
} from "./local-execution-lock.js";
export type { ILocalExecutionLockHandle } from "./local-execution-lock.js";

export { collectBugReportClientContext } from "./bug-report-context.js";
