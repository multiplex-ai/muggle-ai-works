/** Tests for the remote workflowParams.maxRunTimeMs override on workflow start tools. */

import { describe, expect, it } from "vitest";

import { WorkflowParamsSchema, WorkflowStartTestScriptReplayInputSchema } from "../mcp/e2e/contracts/index.js";
import { WorkflowMaxRunTimeTypeEnum } from "../shared/workflow-max-run-time-types.js";

const ONE_MINUTE_MS = 60 * 1000;
const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

describe("WorkflowParamsSchema maxRunTimeMs", () => {
  it("accepts an override for every workflow kind at both ends of the range", () => {
    const maxRunTimeMs = {
      [WorkflowMaxRunTimeTypeEnum.WebsiteScan]: ONE_MINUTE_MS,
      [WorkflowMaxRunTimeTypeEnum.TestScriptGeneration]: ONE_HOUR_MS,
      [WorkflowMaxRunTimeTypeEnum.TestScriptGenerationBulk]: ONE_HOUR_MS,
      [WorkflowMaxRunTimeTypeEnum.TestScriptReplay]: 2 * ONE_MINUTE_MS,
      [WorkflowMaxRunTimeTypeEnum.TestScriptReplayBulk]: 30 * ONE_MINUTE_MS,
      [WorkflowMaxRunTimeTypeEnum.ReportGeneration]: ONE_MINUTE_MS,
    };

    expect(WorkflowParamsSchema.parse({ maxRunTimeMs: maxRunTimeMs })).toEqual({ maxRunTimeMs: maxRunTimeMs });
  });

  it.each([
    ["below one minute", ONE_MINUTE_MS - 1],
    ["above one hour", ONE_HOUR_MS + 1],
    ["fractional", 90_000.5],
    ["a string", "120000"],
  ])("rejects a value that is %s", (_label, invalidMaxRunTimeMs) => {
    const parseResult = WorkflowParamsSchema.safeParse({
      maxRunTimeMs: { [WorkflowMaxRunTimeTypeEnum.TestScriptReplay]: invalidMaxRunTimeMs },
    });

    expect(parseResult.success).toBe(false);
  });

  it("rejects an unknown workflow kind", () => {
    expect(WorkflowParamsSchema.safeParse({ maxRunTimeMs: { prdFileProcess: ONE_MINUTE_MS } }).success).toBe(false);
  });

  it("carries the override through a workflow start input", () => {
    const parsedInput = WorkflowStartTestScriptReplayInputSchema.parse({
      projectId: "44444444-4444-4444-8444-444444444444",
      useCaseId: "55555555-5555-4555-8555-555555555555",
      testCaseId: "11111111-1111-4111-8111-111111111111",
      testScriptId: "22222222-2222-4222-8222-222222222222",
      name: "Replay with a short limit",
      workflowParams: { maxRunTimeMs: { [WorkflowMaxRunTimeTypeEnum.TestScriptReplay]: 3 * ONE_MINUTE_MS } },
    });

    expect(parsedInput.workflowParams?.maxRunTimeMs).toEqual({
      [WorkflowMaxRunTimeTypeEnum.TestScriptReplay]: 3 * ONE_MINUTE_MS,
    });
  });
});
