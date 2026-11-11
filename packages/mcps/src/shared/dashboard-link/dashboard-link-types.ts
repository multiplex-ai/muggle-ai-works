/** Dashboard page a link opens. */
export enum DashboardPage {
  /** Every project the viewer can open. */
  Projects = "projects",
  /** One project's overview. */
  Project = "project",
  /** A project's test case list. */
  TestCases = "test-cases",
  /** A project's test script list. */
  Scripts = "scripts",
  /** The script-details modal for one test case. */
  ScriptDetails = "script-details",
  /** A project's run history. */
  Runs = "runs",
  /** The viewer's own bug reports. */
  BugReports = "bug-reports",
  /** One bug report's timeline. */
  BugReport = "bug-report",
}

/** Project pages that need only the project to resolve. */
export type DashboardProjectPage = DashboardPage.Project | DashboardPage.TestCases | DashboardPage.Scripts | DashboardPage.Runs;

/** What a dashboard link points at; each page carries exactly the ids its route needs. */
export type DashboardLinkTarget =
  | { page: DashboardPage.Projects }
  | { page: DashboardPage.BugReports }
  | { page: DashboardPage.BugReport; bugReportId: string }
  | { page: DashboardProjectPage; projectId: string }
  | { page: DashboardPage.ScriptDetails; projectId: string; testCaseId: string; actionScriptId?: string };
