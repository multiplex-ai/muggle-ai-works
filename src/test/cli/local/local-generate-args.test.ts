import { describe, expect, it } from "vitest";

import { parseLocalGenerateArgs } from "../../../cli/local/local-generate-args.js";
import { LOCAL_FLAG_REQUIRED_MESSAGE } from "../../../cli/local/local-generate-constants.js";

describe("parseLocalGenerateArgs", () => {
  it("maps every flag", () => {
    expect(
      parseLocalGenerateArgs({
        local: true,
        projectId: " proj-1 ",
        testCaseId: "tc-1",
        light: true,
        showUi: true,
        timeoutMs: "600000",
        priority: "promotion",
        json: true,
      }),
    ).toEqual({
      projectId: "proj-1",
      testCaseId: "tc-1",
      isLightMode: true,
      isUiShown: true,
      timeoutMs: 600000,
      priority: "promotion",
      isJsonOutput: true,
    });
  });

  it("defaults to the standard tier, a hidden window and the generation timeout", () => {
    expect(parseLocalGenerateArgs({ local: true, projectId: "proj-1", testCaseId: "tc-1" })).toEqual({
      projectId: "proj-1",
      testCaseId: "tc-1",
      isLightMode: false,
      isUiShown: false,
      isJsonOutput: false,
    });
  });

  it.each([
    [{ projectId: "proj-1", testCaseId: "tc-1" }, LOCAL_FLAG_REQUIRED_MESSAGE],
    [{ local: true, testCaseId: "tc-1" }, "--project-id is required."],
    [{ local: true, projectId: "proj-1", testCaseId: "  " }, "--test-case-id is required."],
    [{ local: true, projectId: "proj-1", testCaseId: "tc-1", timeoutMs: "0" }, "--timeout-ms must be a positive integer, got '0'."],
    [{ local: true, projectId: "proj-1", testCaseId: "tc-1", timeoutMs: "1.5" }, "--timeout-ms must be a positive integer, got '1.5'."],
    [{ local: true, projectId: "proj-1", testCaseId: "tc-1", timeoutMs: "abc" }, "--timeout-ms must be a positive integer, got 'abc'."],
    [
      { local: true, projectId: "proj-1", testCaseId: "tc-1", priority: "urgent" },
      "--priority must be one of paid, free, internal, promotion, got 'urgent'.",
    ],
  ])("rejects %j", (options, expectedMessage) => {
    expect(() => parseLocalGenerateArgs(options)).toThrow(expectedMessage);
  });
});
