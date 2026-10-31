/**
 * Tests for managing a project's resolutions through the project tools: displayResolutions on
 * project create and update, and the tool that reads the resolutions in effect on a lane.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("../shared/config.js", () => ({
  getConfig: () => ({
    logLevel: "silent",
    serverName: "test",
    serverVersion: "0.0.0",
    e2e: {
      promptServiceBaseUrl: "http://test.invalid",
      requestTimeoutMs: 1000,
      workflowTimeoutMs: 5000,
    },
  }),
}));

vi.mock("../shared/logger.js", () => {
  const noop = () => undefined;
  const fakeLogger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    verbose: noop,
    silly: noop,
    child: () => fakeLogger,
  };
  return {
    getLogger: () => fakeLogger,
    createChildLogger: () => fakeLogger,
    resetLogger: noop,
  };
});

vi.mock("../mcp/e2e/upstream-client.js", () => ({
  getPromptServiceClient: () => ({ execute: vi.fn() }),
}));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

import { ProjectCreateInputSchema, ProjectUpdateInputSchema } from "../mcp/e2e/contracts/index.js";
import { DisplayResolution } from "../mcp/local/types/enums.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const CREATE_INPUT = {
  projectName: "Checkout",
  description: "Checkout flows",
  url: "https://shop.example.com",
};
const DESKTOP_AND_PHONE = [DisplayResolution.R_1920x1080, DisplayResolution.R_0390x0844];

describe("displayResolutions on muggle-remote-project-create", () => {
  it("sends the resolutions as the project's displayOptions", () => {
    const call = getQaToolByName("muggle-remote-project-create")!.mapToUpstream(
      ProjectCreateInputSchema.parse({ ...CREATE_INPUT, displayResolutions: DESKTOP_AND_PHONE }),
    );
    expect(call.body).toEqual({
      name: "Checkout",
      description: "Checkout flows",
      url: "https://shop.example.com",
      displayOptions: DESKTOP_AND_PHONE,
    });
  });

  it("leaves displayOptions out so the platform default applies", () => {
    const call = getQaToolByName("muggle-remote-project-create")!.mapToUpstream(CREATE_INPUT);
    expect(call.body).not.toHaveProperty("displayOptions");
  });

  it("rejects an empty list and an unknown resolution", () => {
    expect(() => ProjectCreateInputSchema.parse({ ...CREATE_INPUT, displayResolutions: [] })).toThrow();
    expect(() => ProjectCreateInputSchema.parse({ ...CREATE_INPUT, displayResolutions: ["R_9999x9999"] })).toThrow();
  });
});

describe("displayResolutions on muggle-remote-project-update", () => {
  it("sends the replacement list as displayOptions", () => {
    const call = getQaToolByName("muggle-remote-project-update")!.mapToUpstream(
      ProjectUpdateInputSchema.parse({ projectId: PROJECT_ID, displayResolutions: DESKTOP_AND_PHONE }),
    );
    expect(call.method).toBe("PUT");
    expect(call.body).toEqual({ id: PROJECT_ID, displayOptions: DESKTOP_AND_PHONE });
  });

  it("leaves the resolutions alone when only other fields change, so nothing re-resolves", () => {
    const call = getQaToolByName("muggle-remote-project-update")!.mapToUpstream({
      projectId: PROJECT_ID,
      projectName: "Renamed",
    });
    expect(call.body).not.toHaveProperty("displayOptions");
  });
});

describe("muggle-remote-project-display-resolutions-get", () => {
  const tool = () => getQaToolByName("muggle-remote-project-display-resolutions-get")!;

  it("reads the remote lane's project test spec by default", () => {
    const call = tool().mapToUpstream({ projectId: PROJECT_ID });
    expect(call.method).toBe("GET");
    expect(call.path).toBe(`/v1/protected/muggle-test/projects/${PROJECT_ID}/project-test-spec`);
    expect(call.queryParams).toEqual({ type: "remote" });
  });

  it("reads the local lane when asked", () => {
    const call = tool().mapToUpstream({ projectId: PROJECT_ID, runEnvironmentType: "local" });
    expect(call.queryParams).toEqual({ type: "local" });
  });

  it("returns the lane's resolution default in order, and what the lane enables", () => {
    const output = tool().mapFromUpstream!(
      {
        statusCode: 200,
        headers: {},
        data: {
          projectTestSpec: {
            perAxis: {
              displayResolution: {
                enabledValues: [DisplayResolution.R_0390x0844, DisplayResolution.R_1920x1080],
                default: [DisplayResolution.R_0390x0844, DisplayResolution.R_1920x1080],
                valueGroups: {},
              },
              featureFlags: { enabledValues: [], default: [], valueGroups: {} },
            },
          },
          fanOutPolicy: "primaryFirst",
        },
      },
      { projectId: PROJECT_ID },
    );
    expect(output).toEqual({
      projectId: PROJECT_ID,
      runEnvironmentType: "remote",
      displayResolutions: [DisplayResolution.R_0390x0844, DisplayResolution.R_1920x1080],
      enabledResolutions: [DisplayResolution.R_0390x0844, DisplayResolution.R_1920x1080],
      isPlatformDefault: false,
    });
  });

  it("reports the platform default for a lane that was never edited", () => {
    const output = tool().mapFromUpstream!(
      { statusCode: 200, headers: {}, data: { projectTestSpec: null, fanOutPolicy: "primaryFirst" } },
      { projectId: PROJECT_ID, runEnvironmentType: "local" },
    );
    expect(output).toMatchObject({
      runEnvironmentType: "local",
      displayResolutions: [DisplayResolution.R_1920x1080],
      isPlatformDefault: true,
    });
  });

  it("fails loudly on a body that is not a project test spec", () => {
    expect(() =>
      tool().mapFromUpstream!({ statusCode: 200, headers: {}, data: { unexpected: true } }, { projectId: PROJECT_ID }),
    ).toThrow(/projectTestSpec/);
  });
});
