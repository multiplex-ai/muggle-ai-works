import { afterEach, describe, expect, it } from "vitest";

import { buildDashboardUrl, DashboardPage, withDashboardUrl } from "../shared/dashboard-link/index.js";
import { RUNTIME_TARGET_ENV_VAR } from "../shared/runtime-target-constants.js";

const BASE = "https://dashboard.test/muggleTestV0/dashboard/projects";

afterEach(() => {
  delete process.env[RUNTIME_TARGET_ENV_VAR];
});

describe("buildDashboardUrl", () => {
  it("resolves each page to its dashboard route", () => {
    expect(buildDashboardUrl({ page: DashboardPage.Projects }, BASE)).toBe(BASE);
    expect(buildDashboardUrl({ page: DashboardPage.Project, projectId: "p1" }, BASE)).toBe(`${BASE}/p1`);
    expect(buildDashboardUrl({ page: DashboardPage.TestCases, projectId: "p1" }, BASE)).toBe(`${BASE}/p1/testcases`);
    expect(buildDashboardUrl({ page: DashboardPage.Scripts, projectId: "p1" }, BASE)).toBe(`${BASE}/p1/scripts`);
    expect(buildDashboardUrl({ page: DashboardPage.Runs, projectId: "p1" }, BASE)).toBe(`${BASE}/p1/runs`);
  });

  it("opens the script-details modal, pinned to a script version when one is named", () => {
    expect(
      buildDashboardUrl({ page: DashboardPage.ScriptDetails, projectId: "p1", testCaseId: "tc1" }, BASE),
    ).toBe(`${BASE}/p1/scripts?modal=script-details&testCaseId=tc1`);
    expect(
      buildDashboardUrl(
        { page: DashboardPage.ScriptDetails, projectId: "p1", testCaseId: "tc1", actionScriptId: "as1" },
        BASE,
      ),
    ).toBe(`${BASE}/p1/scripts?modal=script-details&testCaseId=tc1&actionScriptId=as1`);
  });

  it.each([
    ["production", "https://www.muggle-ai.com/muggleTestV0/dashboard/projects/p1/runs"],
    ["staging", "https://staging.muggle-ai.com/muggleTestV0/dashboard/projects/p1/runs"],
    ["dev", "http://localhost:3999/muggleTestV0/dashboard/projects/p1/runs"],
  ])("links into the %s dashboard when the MCP runs on that lane", (target, expectedUrl) => {
    process.env[RUNTIME_TARGET_ENV_VAR] = target;
    expect(buildDashboardUrl({ page: DashboardPage.Runs, projectId: "p1" })).toBe(expectedUrl);
  });
});

describe("withDashboardUrl", () => {
  it("adds the link beside an object response's own fields", () => {
    expect(withDashboardUrl({ id: "p1", name: "Acme" }, `${BASE}/p1`)).toEqual({
      id: "p1",
      name: "Acme",
      dashboardUrl: `${BASE}/p1`,
    });
  });

  it("leaves arrays and scalars as they are, since wrapping them would change their shape", () => {
    const listResponse = [{ id: "p1" }];
    expect(withDashboardUrl(listResponse, BASE)).toBe(listResponse);
    expect(withDashboardUrl(null, BASE)).toBeNull();
    expect(withDashboardUrl("ok", BASE)).toBe("ok");
  });
});
