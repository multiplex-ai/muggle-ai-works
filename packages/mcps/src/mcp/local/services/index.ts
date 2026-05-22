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

export {
  acquireLocalExecutionLock,
  readLocalExecutionLockState,
} from "./local-execution-lock.js";
export type { ILocalExecutionLockHandle } from "./local-execution-lock.js";
