/** Tests for local action-script builders: executionSource tag + SharedTestMemory id. */

import { describe, expect, it } from "vitest";

import {
  buildGenerationActionScript,
  buildReplayActionScript,
} from "../mcp/local/services/action-script-builders.js";
import type { TestCaseDetails, TestScriptDetails } from "../mcp/local/contracts/project-schemas.js";

const PROJECT_ID = "proj-123";

function makeTestCase(): TestCaseDetails {
  return {
    id: "tc-1",
    projectId: PROJECT_ID,
    useCaseId: "uc-1",
    title: "Login with valid creds",
    goal: "User can log in",
    precondition: "",
    instructions: "",
    expectedResult: "Dashboard shown",
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

  it("leaves sharedTestMemoryId empty (resolved server-side, never the projectId)", () => {
    expect(actionParams(script).sharedTestMemoryId).toBe("");
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

  it("leaves sharedTestMemoryId empty (resolved server-side, never the projectId)", () => {
    expect(actionParams(script).sharedTestMemoryId).toBe("");
  });
});
