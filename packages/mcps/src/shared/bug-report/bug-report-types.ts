/** How badly a bug blocks the filer; the filer's own call. */
export enum BugReportSeverityEnum {
  Blocker = "blocker",
  Major = "major",
  Minor = "minor",
}

/** Where a bug report was filed from. */
export enum BugReportSourceEnum {
  Dashboard = "dashboard",
  Harness = "harness",
}

/** Context captured where a bug was filed; every field optional. */
export interface IBugReportClientContext {
  pagePath?: string;
  userAgent?: string;
  workspaceId?: string;
  projectId?: string;
  uiRelease?: string;
  cliVersion?: string;
  studioVersion?: string;
  os?: string;
  lastProjectId?: string;
  lastLocalRunId?: string;
  lastLocalRunStatus?: string;
}

/** Field name of {@link IBugReportClientContext}. */
export type BugReportClientContextField = keyof IBugReportClientContext;

/**
 * Client context after secret-looking and unknown values are removed.
 *
 * Output shape: `{ clientContext: { os: "win32 10.0.26200 x64" }, strippedFieldNames: ["lastProjectId"] }`
 */
export interface ISanitizedBugReportClientContext {
  /** Context safe to send. */
  clientContext: IBugReportClientContext;
  /** Known fields whose value looked like a secret and was dropped. */
  strippedFieldNames: BugReportClientContextField[];
}
