/** What an install attempt did. */
export enum CiInstallOutcome {
  Installed = "installed",
  AlreadyPresent = "already-present",
  NotARepository = "not-a-repository",
}

/** Where the scaffolder wrote, and what it decided. */
export interface CiInstallReport {
  outcome: CiInstallOutcome;
  workflowPath: string;
}

/** Inputs to one install attempt. */
export interface CiInstallOptions {
  cwd: string;
  force: boolean;
}
