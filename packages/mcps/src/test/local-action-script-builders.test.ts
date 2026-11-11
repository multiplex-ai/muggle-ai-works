/** Tests for local action-script builders: executionSource tag, SharedTestMemory id, webview sizing, record naming, light tier. */

import { describe, expect, it } from "vitest";

import {
  buildGenerationActionScript,
  buildReplayActionScript,
} from "../mcp/local/services/action-script-builders.js";
import { RunEnvironment } from "../mcp/e2e/contracts/run-environment.js";
import { LlmTierEnum } from "../shared/llm-tier-types.js";
import type { TestCaseDetails, TestScriptDetails } from "../mcp/local/contracts/project-schemas.js";
import { DisplayResolution } from "../mcp/local/types/enums.js";

const PROJECT_ID = "proj-123";
const STORED_DESCRIPTION = "Log in through the seeded account only. Leave every other account alone.";

const DESKTOP_PARAMS = { browserWindowWidth: 1920, browserWindowHeight: 1080 };
const PHONE_PARAMS = { browserWindowWidth: 390, browserWindowHeight: 844 };
const MACBOOK_PARAMS = { browserWindowWidth: 1512, browserWindowHeight: 982 };

function makeTestCase(storedDisplayOptions?: DisplayResolution[]): TestCaseDetails {
  return {
    id: "tc-1",
    projectId: PROJECT_ID,
    useCaseId: "uc-1",
    title: "Login with valid creds",
    description: STORED_DESCRIPTION,
    goal: "User can log in",
    precondition: "",
    instructions: "",
    expectedResult: "Dashboard shown",
    url: "https://staging.example.com",
    displayOptions: storedDisplayOptions,
  } as unknown as TestCaseDetails;
}

function makeTestScript(): TestScriptDetails {
  return {
    id: "ts-1",
    actionScriptId: "as-1",
    testCaseId: "tc-1",
    projectId: PROJECT_ID,
    useCaseId: "uc-1",
    name: "Login replay",
    url: "https://staging.example.com",
  } as unknown as TestScriptDetails;
}

function actionParams(script: Record<string, unknown>): Record<string, unknown> {
  return script.actionParams as Record<string, unknown>;
}

describe("buildGenerationActionScript", () => {
  const script = buildGenerationActionScript({
    testCase: makeTestCase(),
    localUrl: "http://localhost:3999",
    runId: "run-1",
    localTestScriptId: "lts-1",
    ownerUserId: "user-1",
  });

  it("tags the run as locally executed", () => {
    expect(actionParams(script).executionSource).toBe("local");
  });

  it("tags the run with the local environment lane", () => {
    expect(actionParams(script).runEnvironmentType).toBe("local");
  });

  it("leaves sharedTestMemoryId empty (resolved server-side, never the projectId)", () => {
    expect(actionParams(script).sharedTestMemoryId).toBe("");
  });

  it("carries the cloud url as productionUrl so the run's remoteUrl is not localhost", () => {
    expect(actionParams(script).productionUrl).toBe("https://staging.example.com");
  });

  it("keeps localUrl on actionParams.url, not the cloud url", () => {
    expect(actionParams(script).url).toBe("http://localhost:3999");
  });
});

describe("stored description", () => {
  const generationParams = {
    localUrl: "http://localhost:3999",
    runId: "run-1",
    localTestScriptId: "lts-1",
    ownerUserId: "user-1",
  };
  const replayParams = {
    testScript: makeTestScript(),
    actionScript: [],
    localUrl: "http://localhost:3999",
    runId: "run-1",
    ownerUserId: "user-1",
  };

  it("carries the stored description into a generation with no text for the run", () => {
    const script = buildGenerationActionScript({ ...generationParams, testCase: makeTestCase() });

    expect(script.description).toBe(STORED_DESCRIPTION);
    expect(script.instructions).toBe("");
  });

  it("keeps text given for this run beside the stored description, never in its place", () => {
    const testCase = { ...makeTestCase(), instructions: "Use the staging account." };

    const script = buildGenerationActionScript({ ...generationParams, testCase: testCase });

    expect(script.description).toBe(STORED_DESCRIPTION);
    expect(script.instructions).toBe("Use the staging account.");
  });

  it("falls back to the title when a generation's test case stores no description", () => {
    const testCase = { ...makeTestCase(), description: " " };

    const script = buildGenerationActionScript({ ...generationParams, testCase: testCase });

    expect(script.description).toBe("Login with valid creds");
  });

  it("carries the current stored description into a replay", () => {
    const script = buildReplayActionScript({ ...replayParams, testCaseDescription: STORED_DESCRIPTION });

    expect(script.description).toBe(STORED_DESCRIPTION);
  });

  it("falls back to the script's name when a replay's test case stores no description", () => {
    const script = buildReplayActionScript({ ...replayParams, testCaseDescription: "" });

    expect(script.description).toBe("Login replay");
  });
});

describe("buildReplayActionScript", () => {
  const script = buildReplayActionScript({
    testScript: makeTestScript(),
    testCaseDescription: STORED_DESCRIPTION,
    actionScript: [],
    localUrl: "http://localhost:3999",
    runId: "run-2",
    ownerUserId: "user-1",
  });

  it("tags the run as locally executed", () => {
    expect(actionParams(script).executionSource).toBe("local");
  });

  it("tags the run with the local environment lane", () => {
    expect(actionParams(script).runEnvironmentType).toBe("local");
  });

  it("leaves sharedTestMemoryId empty (resolved server-side, never the projectId)", () => {
    expect(actionParams(script).sharedTestMemoryId).toBe("");
  });

  it("carries the cloud url as productionUrl so the run's remoteUrl is not localhost", () => {
    expect(actionParams(script).productionUrl).toBe("https://staging.example.com");
  });

  it("runs the script against localUrl, not the cloud url", () => {
    expect(script.url).toBe("http://localhost:3999");
  });
});

describe("displayParams sizing", () => {
  function generationWith(params: {
    displayResolution?: DisplayResolution;
    storedDisplayOptions?: DisplayResolution[];
  }): unknown {
    const script = buildGenerationActionScript({
      testCase: makeTestCase(params.storedDisplayOptions),
      localUrl: "http://localhost:3999",
      runId: "run-1",
      localTestScriptId: "lts-1",
      ownerUserId: "user-1",
      displayResolution: params.displayResolution,
    });
    return actionParams(script).displayParams;
  }

  function replayWith(displayResolution?: DisplayResolution): unknown {
    const script = buildReplayActionScript({
      testScript: makeTestScript(),
      testCaseDescription: STORED_DESCRIPTION,
      actionScript: [],
      localUrl: "http://localhost:3999",
      runId: "run-2",
      ownerUserId: "user-1",
      displayResolution: displayResolution,
    });
    return actionParams(script).displayParams;
  }

  it("sizes a generation run at 1920x1080 when nothing is specified", () => {
    expect(generationWith({})).toEqual(DESKTOP_PARAMS);
  });

  it("sizes a generation run from the requested resolution", () => {
    expect(generationWith({ displayResolution: DisplayResolution.R_0390x0844 })).toEqual(PHONE_PARAMS);
  });

  it("sizes a generation run from the test case's stored display option", () => {
    expect(generationWith({ storedDisplayOptions: [DisplayResolution.R_0390x0844] })).toEqual(PHONE_PARAMS);
  });

  it("lets the requested resolution override the test case's stored option", () => {
    expect(
      generationWith({
        displayResolution: DisplayResolution.R_1920x1080,
        storedDisplayOptions: [DisplayResolution.R_0390x0844],
      }),
    ).toEqual(DESKTOP_PARAMS);
  });

  it("sizes a replay run at 1920x1080 when nothing is specified", () => {
    expect(replayWith()).toEqual(DESKTOP_PARAMS);
  });

  it("sizes a replay run from the requested resolution", () => {
    expect(replayWith(DisplayResolution.R_0390x0844)).toEqual(PHONE_PARAMS);
  });

  it("sizes generation and replay runs at a MacBook resolution", () => {
    expect(generationWith({ displayResolution: DisplayResolution.R_1512x0982 })).toEqual(MACBOOK_PARAMS);
    expect(replayWith(DisplayResolution.R_1512x0982)).toEqual(MACBOOK_PARAMS);
  });
});

describe("buildGenerationActionScript run identity", () => {
  const build = (testCaseExtra: Record<string, unknown>, freshSession?: boolean) =>
    actionParams(
      buildGenerationActionScript({
        testCase: { ...makeTestCase(), ...testCaseExtra } as unknown as TestCaseDetails,
        localUrl: "http://localhost:3999",
        runId: "run-1",
        localTestScriptId: "lts-1",
        ownerUserId: "user-1",
        freshSession: freshSession,
      }),
    );

  it("emits pinnedAccount and freshSession for a pinned run that starts fresh", () => {
    const pinnedAccount = { emailSecretId: "sec-e", passwordSecretId: "sec-p" };
    const params = build({ pinnedAccount: pinnedAccount }, true);

    expect(params.pinnedAccount).toEqual(pinnedAccount);
    expect(params.freshSession).toBe(true);
  });

  it("records the effective value, not the test case's stored flag", () => {
    const params = build({ alwaysStartsFreshSession: true }, false);

    expect("freshSession" in params).toBe(false);
  });

  it("emits neither key for a legacy test case", () => {
    const params = build({});

    expect("pinnedAccount" in params).toBe(false);
    expect("freshSession" in params).toBe(false);
  });

  it("emits neither key for an unpinned run that does not start fresh", () => {
    const params = build({ pinnedAccount: null }, false);

    expect("pinnedAccount" in params).toBe(false);
    expect("freshSession" in params).toBe(false);
  });
});

describe("runSettings record naming", () => {
  function generationParams(runSettingsId?: string): Record<string, unknown> {
    return actionParams(
      buildGenerationActionScript({
        testCase: makeTestCase(),
        localUrl: "http://localhost:3999",
        runId: "run-1",
        localTestScriptId: "lts-1",
        ownerUserId: "user-1",
        runSettingsId: runSettingsId,
      }),
    );
  }

  function replayParams(params: {
    testScriptExtra: Record<string, unknown>;
    displayResolution?: DisplayResolution;
  }): Record<string, unknown> {
    return actionParams(
      buildReplayActionScript({
        testScript: { ...makeTestScript(), ...params.testScriptExtra } as TestScriptDetails,
        testCaseDescription: STORED_DESCRIPTION,
        actionScript: [],
        localUrl: "http://localhost:3999",
        runId: "run-2",
        ownerUserId: "user-1",
        displayResolution: params.displayResolution,
      }),
    );
  }

  it("names the record a generation is asked to record against", () => {
    expect(generationParams("rs-390").runSettingsId).toBe("rs-390");
  });

  it("names no record for a generation given none", () => {
    expect("runSettingsId" in generationParams()).toBe(false);
  });

  it("names the record of the local script a replay replays", () => {
    const params = replayParams({ testScriptExtra: { runSettingsId: "rs-390", type: RunEnvironment.Local } });

    expect(params.runSettingsId).toBe("rs-390");
  });

  it("never names a remote script's record, which belongs to the other lane", () => {
    const params = replayParams({ testScriptExtra: { runSettingsId: "rs-remote", type: RunEnvironment.Remote } });

    expect("runSettingsId" in params).toBe(false);
  });

  it("sizes a replay at the size its script was recorded at", () => {
    expect(replayParams({ testScriptExtra: { displayParams: PHONE_PARAMS } }).displayParams).toEqual(PHONE_PARAMS);
  });

  it("accepts a requested resolution equal to the recorded size", () => {
    const params = replayParams({
      testScriptExtra: { displayParams: PHONE_PARAMS },
      displayResolution: DisplayResolution.R_0390x0844,
    });

    expect(params.displayParams).toEqual(PHONE_PARAMS);
  });

  it("refuses to replay a recording at another resolution than it was recorded at", () => {
    expect(() =>
      replayParams({
        testScriptExtra: { displayParams: PHONE_PARAMS, runSettingsId: "rs-390", type: RunEnvironment.Local },
        displayResolution: DisplayResolution.R_1920x1080,
      }),
    ).toThrow("recorded at 390x844");
  });
});

describe("buildReplayActionScript run identity", () => {
  const build = (extra: Record<string, unknown>) =>
    actionParams(
      buildReplayActionScript({
        testScript: makeTestScript(),
        testCaseDescription: STORED_DESCRIPTION,
        actionScript: [],
        localUrl: "http://localhost:3999",
        runId: "run-1",
        ownerUserId: "user-1",
        ...extra,
      }),
    );

  it("emits pinnedAccount and freshSession when given", () => {
    const pinnedAccount = { emailSecretId: "sec-e", passwordSecretId: "sec-p" };
    const params = build({ pinnedAccount: pinnedAccount, freshSession: true });

    expect(params.pinnedAccount).toEqual(pinnedAccount);
    expect(params.freshSession).toBe(true);
  });

  it("emits neither key for a legacy replay", () => {
    const params = build({});

    expect("pinnedAccount" in params).toBe(false);
    expect("freshSession" in params).toBe(false);
  });
});

describe("light-tier workflowParams", () => {
  const generationBase = {
    testCase: makeTestCase(),
    localUrl: "http://localhost:3999",
    runId: "run-1",
    localTestScriptId: "lts-1",
    ownerUserId: "user-1",
  };
  const replayBase = {
    testScript: makeTestScript(),
    testCaseDescription: STORED_DESCRIPTION,
    actionScript: [],
    localUrl: "http://localhost:3999",
    runId: "run-1",
    ownerUserId: "user-1",
  };
  const lightWorkflowParams = { llm: { tier: LlmTierEnum.Light } };

  it("writes the light tier for a light generation", () => {
    const script = buildGenerationActionScript({ ...generationBase, isLightMode: true });
    expect(actionParams(script).workflowParams).toEqual(lightWorkflowParams);
  });

  it("writes the light tier for a light replay", () => {
    const script = buildReplayActionScript({ ...replayBase, isLightMode: true });
    expect(actionParams(script).workflowParams).toEqual(lightWorkflowParams);
  });

  it("leaves workflowParams unset when lightMode is off or absent", () => {
    expect(actionParams(buildGenerationActionScript(generationBase))).not.toHaveProperty("workflowParams");
    expect(actionParams(buildGenerationActionScript({ ...generationBase, isLightMode: false }))).not.toHaveProperty("workflowParams");
    expect(actionParams(buildReplayActionScript(replayBase))).not.toHaveProperty("workflowParams");
    expect(actionParams(buildReplayActionScript({ ...replayBase, isLightMode: false }))).not.toHaveProperty("workflowParams");
  });
});
