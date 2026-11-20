/** The npm dist-tag that heads a release lane of the package. */
export enum ReleaseLaneTag {
  /** Plain releases, e.g. `5.15.0`. */
  Stable = "latest",
  /** Staging builds, e.g. `5.16.0-staging.109`. */
  Staging = "staging",
}

/** What the package step of `muggle upgrade` did. */
export enum WorksPackageUpgradeOutcome {
  /** npm installed the lane's newest version. */
  Updated = "updated",
  /** The global install already is the lane's newest version. */
  AlreadyCurrent = "already-current",
  /** A newer version exists and a check-only run left it uninstalled. */
  UpdateAvailable = "update-available",
  /** npm lists no global install of the package, so there is nothing of npm's to update. */
  NotInstalledGlobally = "not-installed-globally",
  /** The registry gave no usable version for the lane. */
  LookupFailed = "lookup-failed",
  /** npm could not install the newer version. */
  InstallFailed = "install-failed",
}

/** How one npm invocation ended. */
export interface INpmCommandOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs npm with `npmArguments`; resolves undefined when npm could not start or ran past `timeoutMs`. */
export type NpmCommandRunner = (npmArguments: string[], timeoutMs: number) => Promise<INpmCommandOutcome | undefined>;

/** Inputs for the package step of `muggle upgrade`. */
export interface IWorksPackageUpgradeParams {
  /** Report what an upgrade would do without installing. */
  isCheckOnly: boolean;
  runNpm: NpmCommandRunner;
}

/** The package step's outcome and the versions it concerns. */
export interface IWorksPackageUpgradeReport {
  outcome: WorksPackageUpgradeOutcome;
  /** The lane the global install is on; absent when there is no global install. */
  laneTag?: ReleaseLaneTag;
  /** The globally installed version before the step ran. */
  fromVersion?: string;
  /** The lane's newest version, or after an update the version npm reports installed. */
  toVersion?: string;
  /** Why npm could not install; set only for a failed install. */
  failureDetail?: string;
}
