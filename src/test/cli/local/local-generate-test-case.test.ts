import { describe, expect, it } from "vitest";

import { toGenerationTestCase } from "../../../cli/local/local-generate-test-case.js";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const remoteTestCase = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Sign up",
  description: "Sign up with a new account. Do not submit payment.",
  goal: "A new account is created",
  expectedResult: "The dashboard shows",
  precondition: null,
  instructions: "only for one run",
  url: "https://example.com/",
  projectId: PROJECT_ID,
  useCaseId: "33333333-3333-4333-8333-333333333333",
  pinnedAccount: null,
  alwaysStartsFreshSession: true,
  dashboardUrl: "https://www.muggle-ai.com/x",
};

describe("toGenerationTestCase", () => {
  it("copies the stored fields, drops nulls and per-run text, and keeps an explicit unpin", () => {
    expect(toGenerationTestCase({ remoteTestCase: remoteTestCase, expectedProjectId: PROJECT_ID })).toEqual({
      id: remoteTestCase.id,
      title: "Sign up",
      description: "Sign up with a new account. Do not submit payment.",
      goal: "A new account is created",
      expectedResult: "The dashboard shows",
      url: "https://example.com/",
      projectId: PROJECT_ID,
      useCaseId: remoteTestCase.useCaseId,
      pinnedAccount: null,
      alwaysStartsFreshSession: true,
    });
  });

  it("refuses a test case from another project", () => {
    expect(() =>
      toGenerationTestCase({ remoteTestCase: remoteTestCase, expectedProjectId: "44444444-4444-4444-8444-444444444444" }),
    ).toThrow(`belongs to project ${PROJECT_ID}, not 44444444-4444-4444-8444-444444444444`);
  });

  it("refuses a test case with no URL", () => {
    expect(() =>
      toGenerationTestCase({ remoteTestCase: { ...remoteTestCase, url: null }, expectedProjectId: PROJECT_ID }),
    ).toThrow("has no URL to generate against");
  });

  it("refuses a test case missing a required field", () => {
    expect(() =>
      toGenerationTestCase({ remoteTestCase: { ...remoteTestCase, goal: null }, expectedProjectId: PROJECT_ID }),
    ).toThrow();
  });
});
