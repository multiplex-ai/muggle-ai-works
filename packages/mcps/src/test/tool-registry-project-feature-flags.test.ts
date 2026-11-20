/**
 * Tests for the project feature flag tools on the cloud E2E registry.
 *
 * Covers:
 *   - get reading the lane's project test spec and mapping its feature flags axis
 *   - update sending only perAxis.featureFlags with the lane, `defaultValues` travelling as `default`
 *   - schema rejection of an empty update and blank flag names
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: { promptServiceBaseUrl: "http://test.invalid", requestTimeoutMs: 1000, workflowTimeoutMs: 1000 },
  }),
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fakeLogger };
  return { getLogger: () => fakeLogger, createChildLogger: () => fakeLogger, resetLogger: noop };
});

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { ProjectFeatureFlagsUpdateInputSchema, RunEnvironment } from "../mcp/e2e/contracts/index.js";
import { mapProjectFeatureFlags } from "../mcp/tools/e2e/project-feature-flags-transform.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_TEST_SPEC_PATH = `/v1/protected/muggle-test/projects/${PROJECT_ID}/project-test-spec`;
const BETA_FLAGS_AXIS = {
  enabledValues: ["newCheckout", "darkMode"],
  default: ["newCheckout"],
  valueGroups: { beta: ["newCheckout", "darkMode"] },
};

function mapToolInput(toolName: string, toolInput: Record<string, unknown>) {
  const tool = getQaToolByName(toolName)!;
  return tool.mapToUpstream(tool.inputSchema.parse(toolInput));
}

describe("muggle-remote-project-feature-flags-get", () => {
  it("reads the remote lane's project test spec by default", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-feature-flags-get", { projectId: PROJECT_ID });

    expect(upstreamCall.method).toBe("GET");
    expect(upstreamCall.path).toBe(PROJECT_TEST_SPEC_PATH);
    expect(upstreamCall.queryParams).toEqual({ type: "remote" });
  });

  it("maps effectivePerAxis.featureFlags, renaming default to defaultValues", () => {
    const projectFeatureFlags = mapProjectFeatureFlags(
      {
        statusCode: 200,
        data: { projectTestSpec: null, effectivePerAxis: { featureFlags: BETA_FLAGS_AXIS }, fanOutPolicy: "primaryOnly" },
        headers: {},
      },
      { projectId: PROJECT_ID, runEnvironmentType: RunEnvironment.Local },
    );

    expect(projectFeatureFlags).toEqual({
      projectId: PROJECT_ID,
      runEnvironmentType: "local",
      featureFlags: {
        enabledValues: ["newCheckout", "darkMode"],
        defaultValues: ["newCheckout"],
        valueGroups: { beta: ["newCheckout", "darkMode"] },
      },
    });
  });

  it("falls back to the saved spec, then to empty lists", () => {
    const fromSavedSpec = mapProjectFeatureFlags(
      { statusCode: 200, data: { projectTestSpec: { perAxis: { featureFlags: BETA_FLAGS_AXIS } } }, headers: {} },
      { projectId: PROJECT_ID },
    );
    const fromNothing = mapProjectFeatureFlags({ statusCode: 200, data: {}, headers: {} }, { projectId: PROJECT_ID });

    expect(fromSavedSpec.featureFlags.enabledValues).toEqual(["newCheckout", "darkMode"]);
    expect(fromNothing).toEqual({
      projectId: PROJECT_ID,
      runEnvironmentType: "remote",
      featureFlags: { enabledValues: [], defaultValues: [], valueGroups: {} },
    });
  });
});

describe("muggle-remote-project-feature-flags-update", () => {
  it("puts only the feature flags axis with the lane", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-feature-flags-update", {
      projectId: PROJECT_ID,
      runEnvironmentType: "local",
      enabledValues: ["newCheckout"],
      defaultValues: [],
    });

    expect(upstreamCall.method).toBe("PUT");
    expect(upstreamCall.path).toBe(PROJECT_TEST_SPEC_PATH);
    expect(upstreamCall.body).toEqual({
      laneType: "local",
      perAxis: { featureFlags: { enabledValues: ["newCheckout"], default: [] } },
    });
  });

  it("defaults the lane to remote and sends value groups alone", () => {
    const upstreamCall = mapToolInput("muggle-remote-project-feature-flags-update", {
      projectId: PROJECT_ID,
      valueGroups: {},
    });

    expect(upstreamCall.body).toEqual({ laneType: "remote", perAxis: { featureFlags: { valueGroups: {} } } });
  });

  it("warns that the change re-resolves the lane's test cases", () => {
    expect(getQaToolByName("muggle-remote-project-feature-flags-update")!.description).toContain("re-resolves every test case");
  });

  it.each([
    ["no flag field", { projectId: PROJECT_ID }],
    ["a blank flag name", { projectId: PROJECT_ID, enabledValues: [""] }],
    ["an unknown lane", { projectId: PROJECT_ID, runEnvironmentType: "staging", enabledValues: ["beta"] }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(ProjectFeatureFlagsUpdateInputSchema.safeParse(toolInput).success).toBe(false);
  });
});
