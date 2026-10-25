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
  listActiveExecutions,
} from "./execution-service.js";

export { findRunCheckoutRefusal, isLoopbackUrl } from "./run-checkout-gate.js";

export { recordTelemetryEvent } from "./telemetry-event-service.js";

export {
  acquireLocalExecutionLock,
  LaneRelation,
  LocalExecutionLaneBusyError,
  readLocalExecutionLaneStatus,
  tryAcquireLocalExecutionLane,
} from "./local-execution-lock.js";
export type {
  ILaneAttempt,
  ILaneBusyDetails,
  ILaneStatusReport,
  ILocalExecutionLockHandle,
} from "./local-execution-lock.js";
