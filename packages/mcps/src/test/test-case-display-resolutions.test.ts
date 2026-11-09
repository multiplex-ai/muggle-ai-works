/**
 * Tests for reading and setting the resolutions one test case runs at on a lane, through its test spec.
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
  RunStrategy,
  TestCaseDisplayResolutionsGetInputSchema,
  TestCaseDisplayResolutionsUpdateInputSchema,
} from "../mcp/e2e/contracts/index.js";
import { DisplayResolution } from "../mcp/local/types/enums.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const TEST_CASE_ID = "55555555-5555-4555-8555-555555555555";
const TEST_SPEC_PATH = `/v1/protected/muggle-test/projects/${PROJECT_ID}/test-cases/${TEST_CASE_ID}/test-spec`;
const DESKTOP = DisplayResolution.R_1920x1080;
const PHONE = DisplayResolution.R_0390x0844;
const PHONE_RECORD = { id: "rs-phone", displayParams: { browserWindowWidth: 390, browserWindowHeight: 844 } };
const DESKTOP_RECORD = { id: "rs-desktop", displayParams: { browserWindowWidth: 1920, browserWindowHeight: 1080 } };
const TEST_CASE_LANE = { projectId: PROJECT_ID, testCaseId: TEST_CASE_ID };

const getTool = () => getQaToolByName("muggle-remote-test-case-display-resolutions-get")!;
const updateTool = () => getQaToolByName("muggle-remote-test-case-display-resolutions-update")!;
const mapUpdate = (fields: Record<string, unknown>) =>
  updateTool().mapToUpstream(TestCaseDisplayResolutionsUpdateInputSchema.parse({ ...TEST_CASE_LANE, ...fields }));
const mapEnvelope = (envelope: unknown, runEnvironmentType?: string) =>
  getTool().mapFromUpstream!(
    { statusCode: 200, headers: {}, data: envelope },
    { ...TEST_CASE_LANE, ...(runEnvironmentType !== undefined && { runEnvironmentType: runEnvironmentType }) },
  );

describe("muggle-remote-test-case-display-resolutions-get", () => {
  it("reads the remote lane's test spec by default", () => {
    const call = getTool().mapToUpstream(TEST_CASE_LANE);
    expect(call.method).toBe("GET");
    expect(call.path).toBe(TEST_SPEC_PATH);
    expect(call.queryParams).toEqual({ type: "remote" });
  });

  it("reads the local lane when asked", () => {
    expect(getTool().mapToUpstream({ ...TEST_CASE_LANE, runEnvironmentType: "local" }).queryParams).toEqual({
      type: "local",
    });
  });

  it("rejects ids that are not UUIDs and an unknown lane", () => {
    expect(TestCaseDisplayResolutionsGetInputSchema.safeParse({ ...TEST_CASE_LANE, testCaseId: "TC-655" }).success).toBe(
      false,
    );
    expect(
      TestCaseDisplayResolutionsGetInputSchema.safeParse({ ...TEST_CASE_LANE, runEnvironmentType: "staging" }).success,
    ).toBe(false);
  });

  it("lists the resolutions primary first, with each record flagged and the effective run strategy", () => {
    const output = mapEnvelope({
      testSpec: { axes: { displayResolution: [[DESKTOP], [PHONE]], featureFlags: [["beta"]] } },
      runSettingsList: [DESKTOP_RECORD, PHONE_RECORD],
      primaryRunSettingsId: "rs-phone",
      effectiveFanOutPolicy: "primaryFirst",
    });
    expect(output).toEqual({
      projectId: PROJECT_ID,
      testCaseId: TEST_CASE_ID,
      runEnvironmentType: "remote",
      hasOwnTestSpec: true,
      displayResolutions: [PHONE, DESKTOP],
      primaryResolution: PHONE,
      featureFlags: [["beta"]],
      runStrategy: "primaryFirst",
      runSettingsList: [
        { runSettingsId: "rs-desktop", resolutionLabel: "1920×1080", displayResolution: DESKTOP, isPrimary: false },
        { runSettingsId: "rs-phone", resolutionLabel: "390×844", displayResolution: PHONE, isPrimary: true },
      ],
    });
  });

  it("reports a test case with no spec of its own and no records on the lane", () => {
    const output = mapEnvelope(
      { testSpec: null, runSettingsList: [], primaryRunSettingsId: null, effectiveFanOutPolicy: "primaryOnly" },
      "local",
    );
    expect(output).toEqual({
      projectId: PROJECT_ID,
      testCaseId: TEST_CASE_ID,
      runEnvironmentType: "local",
      hasOwnTestSpec: false,
      displayResolutions: [],
      primaryResolution: null,
      featureFlags: null,
      runStrategy: "primaryOnly",
      runSettingsList: [],
    });
  });

  it("leaves a record whose size matches no known resolution out of the resolution list", () => {
    const output = mapEnvelope({
      testSpec: { axes: {} },
      runSettingsList: [{ id: "rs-odd", displayParams: { browserWindowWidth: 1, browserWindowHeight: 1 } }, PHONE_RECORD],
      primaryRunSettingsId: "rs-odd",
    });
    expect(output).toMatchObject({
      displayResolutions: [PHONE],
      primaryResolution: null,
      featureFlags: null,
      runStrategy: "primaryOnly",
    });
  });

  it("fails when the body carries no runSettingsList", () => {
    expect(() => mapEnvelope({ testSpec: null })).toThrow(/runSettingsList/);
    expect(() => mapEnvelope(undefined)).toThrow(/runSettingsList/);
  });
});

describe("muggle-remote-test-case-display-resolutions-update", () => {
  it("commits one displayResolution value set per resolution on the remote lane by default", () => {
    const call = mapUpdate({ displayResolutions: [PHONE] });
    expect(call.method).toBe("POST");
    expect(call.path).toBe(`${TEST_SPEC_PATH}/commit`);
    expect(call.body).toEqual({ laneType: "remote", axes: { displayResolution: [[PHONE]] } });
  });

  it("drops duplicate resolutions, keeping each one's first position", () => {
    expect(mapUpdate({ displayResolutions: [PHONE, DESKTOP, PHONE] }).body).toMatchObject({
      axes: { displayResolution: [[PHONE], [DESKTOP]] },
    });
  });

  it("passes back the kept feature-flag variants and the run strategy", () => {
    const call = mapUpdate({
      displayResolutions: [DESKTOP, PHONE],
      featureFlags: [["beta"], { groupName: "checkout-flags" }],
      runStrategy: RunStrategy.AllAtOnce,
      runEnvironmentType: "local",
    });
    expect(call.body).toEqual({
      laneType: "local",
      axes: { displayResolution: [[DESKTOP], [PHONE]], featureFlags: [["beta"], { groupName: "checkout-flags" }] },
      fanOutPolicy: "allAtOnce",
    });
  });

  it("sends a null run strategy to return the test case to the project lane's", () => {
    expect(mapUpdate({ displayResolutions: [PHONE], runStrategy: null }).body).toMatchObject({ fanOutPolicy: null });
    expect(mapUpdate({ displayResolutions: [PHONE] }).body).not.toHaveProperty("fanOutPolicy");
  });

  it("reads the test spec back after the commit and answers in the get tool's shape", () => {
    const input = TestCaseDisplayResolutionsUpdateInputSchema.parse({ ...TEST_CASE_LANE, displayResolutions: [PHONE] });
    expect(updateTool().mapToFollowUpUpstream!(input)).toEqual([
      { method: "GET", path: TEST_SPEC_PATH, queryParams: { type: "remote" } },
    ]);
    expect(updateTool().mapFromUpstream).toBe(getTool().mapFromUpstream);
  });

  it("rejects an empty list, an unknown resolution and an unknown run strategy", () => {
    expect(TestCaseDisplayResolutionsUpdateInputSchema.safeParse({ ...TEST_CASE_LANE, displayResolutions: [] }).success).toBe(
      false,
    );
    expect(
      TestCaseDisplayResolutionsUpdateInputSchema.safeParse({ ...TEST_CASE_LANE, displayResolutions: ["R_9999x9999"] })
        .success,
    ).toBe(false);
    expect(
      TestCaseDisplayResolutionsUpdateInputSchema.safeParse({
        ...TEST_CASE_LANE,
        displayResolutions: [PHONE],
        runStrategy: "allNow",
      }).success,
    ).toBe(false);
  });
});
