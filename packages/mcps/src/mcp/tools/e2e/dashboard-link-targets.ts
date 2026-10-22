/**
 * Which dashboard page each cloud tool's response is viewable on. Ids come from the validated input
 * when the tool takes them, else from the upstream entity the response returns.
 */

import { DashboardPage, type DashboardLinkTarget, type DashboardProjectPage } from "../../../shared/dashboard-link/index.js";
import type { IUpstreamResponse } from "../../e2e/types.js";

function readStringField(source: unknown, key: string): string | undefined {
  if (source === null || typeof source !== "object") {
    return undefined;
  }
  const fieldValue = (source as Record<string, unknown>)[key];
  return typeof fieldValue === "string" && fieldValue !== "" ? fieldValue : undefined;
}

/**
 * Link every response to the project list.
 * @returns The projects page target.
 */
export function linkToProjects(): DashboardLinkTarget {
  return { page: DashboardPage.Projects };
}

/**
 * Link a tool taking `projectId` to one of that project's pages.
 * @param page - Project page to open.
 * @returns A target builder reading `projectId` from the input.
 */
export function linkToInputProjectPage(page: DashboardProjectPage): (input: unknown) => DashboardLinkTarget | null {
  return (input) => {
    const projectId = readStringField(input, "projectId");
    return projectId ? { page: page, projectId: projectId } : null;
  };
}

/**
 * Link a newly created project to its overview, using the id the response returns.
 * @param _input - Unused; the id only exists once the project does.
 * @param response - Upstream response carrying the created project.
 * @returns The project page target, or null when the response has no id.
 */
export function linkToCreatedProject(_input: unknown, response: IUpstreamResponse): DashboardLinkTarget | null {
  const projectId = readStringField(response.data, "id");
  return projectId ? { page: DashboardPage.Project, projectId: projectId } : null;
}

/**
 * Link a tool taking `projectId` and `testCaseId` to that test case's script details.
 * @param input - Validated tool input.
 * @returns The script-details target, or null when either id is absent.
 */
export function linkToInputScriptDetails(input: unknown): DashboardLinkTarget | null {
  const projectId = readStringField(input, "projectId");
  const testCaseId = readStringField(input, "testCaseId");
  return projectId && testCaseId
    ? { page: DashboardPage.ScriptDetails, projectId: projectId, testCaseId: testCaseId }
    : null;
}

/**
 * Link a fetched test case to its script details; the project comes from the returned test case.
 * @param input - Validated input carrying `testCaseId`.
 * @param response - Upstream response carrying the test case.
 * @returns The script-details target, or null when either id is absent.
 */
export function linkToFetchedTestCase(input: unknown, response: IUpstreamResponse): DashboardLinkTarget | null {
  const projectId = readStringField(response.data, "projectId");
  const testCaseId = readStringField(input, "testCaseId");
  return projectId && testCaseId
    ? { page: DashboardPage.ScriptDetails, projectId: projectId, testCaseId: testCaseId }
    : null;
}

/**
 * Link a fetched test script to its script details, pinned to its action script when it has one.
 * @param _input - Unused; the returned script names its own test case.
 * @param response - Upstream response carrying the test script.
 * @returns The script-details target, or null when the script lacks its project or test case.
 */
export function linkToFetchedTestScript(_input: unknown, response: IUpstreamResponse): DashboardLinkTarget | null {
  const projectId = readStringField(response.data, "projectId");
  const testCaseId = readStringField(response.data, "testCaseId");
  if (!projectId || !testCaseId) {
    return null;
  }
  const actionScriptId = readStringField(response.data, "actionScriptId");
  return {
    page: DashboardPage.ScriptDetails,
    projectId: projectId,
    testCaseId: testCaseId,
    ...(actionScriptId ? { actionScriptId: actionScriptId } : {}),
  };
}
