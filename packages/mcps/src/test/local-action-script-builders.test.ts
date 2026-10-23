/** Tests for local action-script builders: executionSource tag, SharedTestMemory id, webview sizing, record naming. */

import { describe, expect, it } from "vitest";

import {
  buildGenerationActionScript,
  buildReplayActionScript,
} from "../mcp/local/services/action-script-builders.js";
import { RunEnvironment } from "../mcp/e2e/contracts/run-environment.js";
import type { TestCaseDetails, TestScriptDetails } from "../mcp/local/contracts/project-schemas.js";
import { DisplayResolution } from "../mcp/local/types/enums.js";

const PROJECT_ID = "proj-123";

const DESKTOP_PARAMS = { browserWindowWidth: 1920, browserWindowHeight: 1080 };
const PHONE_PARAMS = { browserWindowWidth: 390, browserWindowHeight: 844 };

function makeTestCase(storedDisplayOptions?: DisplayResolution[]): TestCaseDetails {
  return {
    id: "tc-1",
    projectId: PROJECT_ID,
    useCaseId: "uc-1",
    title: "Login with valid creds",
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

describe("buildReplayActionScript", () => {
  const script = buildReplayActionScript({
    testScript: makeTestScript(),
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
