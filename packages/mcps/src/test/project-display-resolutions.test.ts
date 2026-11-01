/**
 * Tests for managing a project's resolutions and run strategy through the project tools: the primary
 * resolution, compatible resolutions and run strategy on project create and update, and the tool that
 * reads them back for a lane.
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

import {
  ProjectCreateInputSchema,
  ProjectDisplayResolutionsGetInputSchema,
  ProjectUpdateInputSchema,
  RunStrategy,
} from "../mcp/e2e/contracts/index.js";
import { DisplayResolution } from "../mcp/local/types/enums.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const CREATE_INPUT = {
  projectName: "Checkout",
  description: "Checkout flows",
  url: "https://shop.example.com",
};
const DESKTOP = DisplayResolution.R_1920x1080;
const PHONE = DisplayResolution.R_0390x0844;
const TABLET = DisplayResolution.R_0768x1024;
const UNKNOWN_RESOLUTION = "R_9999x9999";

const mapProjectUpdate = (fields: Record<string, unknown>) =>
  getQaToolByName("muggle-remote-project-update")!.mapToUpstream(
    ProjectUpdateInputSchema.parse({ projectId: PROJECT_ID, ...fields }),
  );

describe("resolution fields on muggle-remote-project-create", () => {
  const mapProjectCreate = (fields: Record<string, unknown>) =>
    getQaToolByName("muggle-remote-project-create")!.mapToUpstream(
      ProjectCreateInputSchema.parse({ ...CREATE_INPUT, ...fields }),
    );

  it("sends the primary then the compatible resolutions as displayOptions, and the run strategy as fanOutPolicy", () => {
    const call = mapProjectCreate({
      primaryResolution: DESKTOP,
      compatibleResolutions: [PHONE],
      runStrategy: RunStrategy.PrimaryFirst,
    });
    expect(call.body).toEqual({
      name: "Checkout",
      description: "Checkout flows",
      url: "https://shop.example.com",
      displayOptions: [DESKTOP, PHONE],
      fanOutPolicy: "primaryFirst",
    });
  });

  it("leaves displayOptions and fanOutPolicy out so the platform defaults apply", () => {
    const call = mapProjectCreate({});
    expect(call.body).not.toHaveProperty("displayOptions");
    expect(call.body).not.toHaveProperty("fanOutPolicy");
  });

  it("accepts each run strategy the backend knows", () => {
    for (const runStrategy of ["primaryOnly", "primaryFirst", "allAtOnce"]) {
      expect(mapProjectCreate({ runStrategy: runStrategy }).body).toMatchObject({ fanOutPolicy: runStrategy });
    }
  });

  it("rejects an unknown resolution and an unknown run strategy", () => {
    expect(() => ProjectCreateInputSchema.parse({ ...CREATE_INPUT, primaryResolution: UNKNOWN_RESOLUTION })).toThrow();
    expect(() =>
      ProjectCreateInputSchema.parse({
        ...CREATE_INPUT,
        primaryResolution: DESKTOP,
        compatibleResolutions: [UNKNOWN_RESOLUTION],
      }),
    ).toThrow();
    expect(() => ProjectCreateInputSchema.parse({ ...CREATE_INPUT, runStrategy: "allNow" })).toThrow();
  });

  it("rejects compatible resolutions that include the primary", () => {
    const parsed = ProjectCreateInputSchema.safeParse({
      ...CREATE_INPUT,
      primaryResolution: DESKTOP,
      compatibleResolutions: [PHONE, DESKTOP],
    });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({ path: ["compatibleResolutions"], message: expect.stringContaining(DESKTOP) }),
    ]);
  });
});

describe("resolution fields on muggle-remote-project-update", () => {
  it("sends the replacement list primary first", () => {
    const call = mapProjectUpdate({ primaryResolution: PHONE, compatibleResolutions: [DESKTOP, TABLET] });
    expect(call.method).toBe("PUT");
    expect(call.body).toEqual({ id: PROJECT_ID, displayOptions: [PHONE, DESKTOP, TABLET] });
  });

  it("clears the compatible resolutions when only the primary is passed", () => {
    expect(mapProjectUpdate({ primaryResolution: DESKTOP }).body).toEqual({ id: PROJECT_ID, displayOptions: [DESKTOP] });
    expect(mapProjectUpdate({ primaryResolution: DESKTOP, compatibleResolutions: [] }).body).toEqual({
      id: PROJECT_ID,
      displayOptions: [DESKTOP],
    });
  });

  it("drops duplicate compatible resolutions, keeping each one's first position", () => {
    const call = mapProjectUpdate({ primaryResolution: DESKTOP, compatibleResolutions: [PHONE, TABLET, PHONE] });
    expect(call.body).toEqual({ id: PROJECT_ID, displayOptions: [DESKTOP, PHONE, TABLET] });
  });

  it("changes only the run strategy when no resolution is passed", () => {
    const call = mapProjectUpdate({ runStrategy: RunStrategy.AllAtOnce });
    expect(call.body).toEqual({ id: PROJECT_ID, fanOutPolicy: "allAtOnce" });
  });

  it("leaves the resolutions and run strategy alone when only other fields change", () => {
    const call = mapProjectUpdate({ projectName: "Renamed" });
    expect(call.body).toEqual({ id: PROJECT_ID, name: "Renamed" });
  });

  it("rejects compatible resolutions without the primary, naming the tool that reads it", () => {
    const parsed = ProjectUpdateInputSchema.safeParse({ projectId: PROJECT_ID, compatibleResolutions: [PHONE] });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual([
      expect.objectContaining({
        path: ["compatibleResolutions"],
        message: expect.stringContaining("muggle-remote-project-display-resolutions-get"),
      }),
    ]);
    expect(ProjectUpdateInputSchema.safeParse({ projectId: PROJECT_ID, compatibleResolutions: [] }).success).toBe(false);
  });
});

describe("muggle-remote-project-display-resolutions-get", () => {
  const tool = () => getQaToolByName("muggle-remote-project-display-resolutions-get")!;
  const displayResolutionPerAxis = (resolutions: string[]) => ({
    displayResolution: { enabledValues: resolutions, default: resolutions, valueGroups: {} },
    featureFlags: { enabledValues: [], default: [], valueGroups: {} },
  });
  const mapEnvelope = (envelope: unknown, runEnvironmentType?: string) =>
    tool().mapFromUpstream!(
      { statusCode: 200, headers: {}, data: envelope },
      { projectId: PROJECT_ID, ...(runEnvironmentType !== undefined && { runEnvironmentType: runEnvironmentType }) },
    );

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

  it("rejects a project ID that is not a UUID", () => {
    expect(ProjectDisplayResolutionsGetInputSchema.safeParse({ projectId: "not-a-uuid" }).success).toBe(false);
    expect(ProjectDisplayResolutionsGetInputSchema.safeParse({ projectId: PROJECT_ID }).success).toBe(true);
  });

  it("splits the effective resolution default into primary and compatible, with the run strategy", () => {
    const output = mapEnvelope({
      effectivePerAxis: displayResolutionPerAxis([PHONE, DESKTOP, TABLET]),
      projectTestSpec: { perAxis: displayResolutionPerAxis([DESKTOP]), fanOutPolicy: "primaryFirst" },
      fanOutPolicy: "primaryFirst",
    });
    expect(output).toEqual({
      projectId: PROJECT_ID,
      runEnvironmentType: "remote",
      primaryResolution: PHONE,
      compatibleResolutions: [DESKTOP, TABLET],
      enabledResolutions: [PHONE, DESKTOP, TABLET],
      runStrategy: "primaryFirst",
    });
  });

  it("reads the backend's effective resolutions for a lane that was never edited", () => {
    const output = mapEnvelope(
      { effectivePerAxis: displayResolutionPerAxis([DESKTOP]), projectTestSpec: null, fanOutPolicy: "primaryOnly" },
      "local",
    );
    expect(output).toEqual({
      projectId: PROJECT_ID,
      runEnvironmentType: "local",
      primaryResolution: DESKTOP,
      compatibleResolutions: [],
      enabledResolutions: [DESKTOP],
      runStrategy: "primaryOnly",
    });
  });

  it("falls back to the saved spec's resolutions from a backend that sends no effectivePerAxis", () => {
    const output = mapEnvelope({
      projectTestSpec: { perAxis: displayResolutionPerAxis([TABLET, PHONE]), fanOutPolicy: "allAtOnce" },
      fanOutPolicy: "allAtOnce",
    });
    expect(output).toMatchObject({
      primaryResolution: TABLET,
      compatibleResolutions: [PHONE],
      enabledResolutions: [TABLET, PHONE],
      runStrategy: "allAtOnce",
    });
  });

  it("reports the backend's effective run strategy over the one saved on the spec", () => {
    const output = mapEnvelope({
      effectivePerAxis: displayResolutionPerAxis([DESKTOP]),
      projectTestSpec: { perAxis: displayResolutionPerAxis([DESKTOP]), fanOutPolicy: "primaryFirst" },
      fanOutPolicy: "allAtOnce",
    });
    expect(output).toMatchObject({ runStrategy: "allAtOnce" });
  });

  it("reports primaryOnly when the backend sends no run strategy", () => {
    const output = mapEnvelope({ effectivePerAxis: displayResolutionPerAxis([DESKTOP]), projectTestSpec: null });
    expect(output).toMatchObject({ runStrategy: "primaryOnly" });
  });

  it("never promotes a compatible resolution when the primary is one this version does not know", () => {
    const output = mapEnvelope({
      effectivePerAxis: displayResolutionPerAxis([UNKNOWN_RESOLUTION, PHONE]),
      fanOutPolicy: "primaryOnly",
    });
    expect(output).toMatchObject({ primaryResolution: null, compatibleResolutions: [PHONE], enabledResolutions: [PHONE] });
  });

  it("fails instead of inventing a default when neither effectivePerAxis nor the saved spec carries resolutions", () => {
    expect(() => mapEnvelope({ projectTestSpec: null, fanOutPolicy: "primaryOnly" })).toThrow(/effectivePerAxis/);
    expect(() => mapEnvelope({ unexpected: true })).toThrow(/no display resolutions/);
    expect(() => mapEnvelope(undefined)).toThrow(/no display resolutions/);
  });
});
