import { getDashboardBaseUrl } from "../config.js";
import {
  DASHBOARD_PROJECT_PAGE_SEGMENTS,
  DASHBOARD_URL_FIELD,
  SCRIPT_DETAILS_MODAL_VALUE,
  SCRIPTS_MODAL_ACTION_SCRIPT_ID_KEY,
  SCRIPTS_MODAL_QUERY_KEY,
  SCRIPTS_MODAL_TEST_CASE_ID_KEY,
} from "./dashboard-link-constants.js";
import { DashboardPage, type DashboardLinkTarget } from "./dashboard-link-types.js";

/**
 * Build the dashboard URL for a target on the lane this MCP runs on.
 *
 * Output shape: `https://staging.muggle-ai.com/muggleTestV0/dashboard/projects/p1/scripts?modal=script-details&testCaseId=tc1`
 * @param target - Page and the ids its route needs.
 * @param dashboardBaseUrl - Projects base to resolve against; defaults to the active lane's.
 * @returns Absolute dashboard URL.
 */
export function buildDashboardUrl(
  target: DashboardLinkTarget,
  dashboardBaseUrl: string = getDashboardBaseUrl(),
): string {
  if (target.page === DashboardPage.Projects) {
    return dashboardBaseUrl;
  }
  const projectUrl = `${dashboardBaseUrl}/${encodeURIComponent(target.projectId)}`;
  if (target.page === DashboardPage.ScriptDetails) {
    const query = new URLSearchParams({
      [SCRIPTS_MODAL_QUERY_KEY]: SCRIPT_DETAILS_MODAL_VALUE,
      [SCRIPTS_MODAL_TEST_CASE_ID_KEY]: target.testCaseId,
    });
    if (target.actionScriptId) {
      query.set(SCRIPTS_MODAL_ACTION_SCRIPT_ID_KEY, target.actionScriptId);
    }
    return `${projectUrl}/${DASHBOARD_PROJECT_PAGE_SEGMENTS[DashboardPage.Scripts]}?${query.toString()}`;
  }
  const segment = DASHBOARD_PROJECT_PAGE_SEGMENTS[target.page];
  return segment ? `${projectUrl}/${segment}` : projectUrl;
}

/**
 * Add a `dashboardUrl` field to a tool's object output. Arrays and scalars come back unchanged,
 * since wrapping them would change the shape every existing caller reads.
 * @param toolOutput - The mapped tool response.
 * @param dashboardUrl - Link to attach.
 * @returns The output with the link attached, or the output itself when it is not an object.
 */
export function withDashboardUrl(toolOutput: unknown, dashboardUrl: string): unknown {
  if (toolOutput === null || typeof toolOutput !== "object" || Array.isArray(toolOutput)) {
    return toolOutput;
  }
  return { ...(toolOutput as Record<string, unknown>), [DASHBOARD_URL_FIELD]: dashboardUrl };
}
