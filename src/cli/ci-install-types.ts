/** What an install attempt did. */
export enum CiInstallOutcome {
  Installed = "installed",
  /** An unedited copy from an earlier release was replaced with the current rendering. */
  Updated = "updated",
  AlreadyCurrent = "already-current",
  /** The consumer edited the workflow, so it was left untouched. */
  KeptCustomized = "kept-customized",
  /** A customised workflow was overwritten because `--force` asked for it. */
  Replaced = "replaced",
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
