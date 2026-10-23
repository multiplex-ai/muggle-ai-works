import { DashboardPage, type DashboardProjectPage } from "./dashboard-link-types.js";

/** Path segment under `/<projectId>` for each project page; the overview has none. */
export const DASHBOARD_PROJECT_PAGE_SEGMENTS: Record<DashboardProjectPage, string> = {
  [DashboardPage.Project]: "",
  [DashboardPage.TestCases]: "testcases",
  [DashboardPage.Scripts]: "scripts",
  [DashboardPage.Runs]: "runs",
};

/** Query key naming which scripts-page modal a link opens. */
export const SCRIPTS_MODAL_QUERY_KEY = "modal";

/** Value of {@link SCRIPTS_MODAL_QUERY_KEY} that opens the script-details modal. */
export const SCRIPT_DETAILS_MODAL_VALUE = "script-details";

/** Query key carrying the test case the script-details modal opens on. */
export const SCRIPTS_MODAL_TEST_CASE_ID_KEY = "testCaseId";

/** Query key pre-selecting one script version in the script-details modal. */
export const SCRIPTS_MODAL_ACTION_SCRIPT_ID_KEY = "actionScriptId";

/** Field a tool response carries its dashboard link in. */
export const DASHBOARD_URL_FIELD = "dashboardUrl";
