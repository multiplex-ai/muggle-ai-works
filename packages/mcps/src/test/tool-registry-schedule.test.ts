/**
 * Tests for the schedule tools on the cloud E2E registry.
 *
 * Covers:
 *   - update putting only the editable task definition fields and the status to the runtime's path
 *   - delete mapping to the runtime's path and warning that it is permanent
 *   - schema rejection of statuses other than pause/resume, intervalSec, bad weekdays and an empty update
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

import { ScheduleStatusEnum, ScheduleUpdateInputSchema } from "../mcp/e2e/contracts/index.js";
import { getQaToolByName } from "../mcp/tools/e2e/tool-registry.js";

const WORKFLOW_RUNTIME_ID = "11111111-1111-4111-8111-111111111111";
const SCHEDULE_PATH = `/v1/protected/muggle-test/workflow/test-script/test-script-replay/bulk/${WORKFLOW_RUNTIME_ID}`;
const WEEKDAY_MORNINGS = {
  type: "weekly",
  daysOfWeek: [1, 2, 3, 4, 5],
  time: { hour: 9, minute: 30 },
  timezone: "America/Los_Angeles",
};

function mapToolInput(toolName: string, toolInput: Record<string, unknown>) {
  const tool = getQaToolByName(toolName)!;
  return tool.mapToUpstream(tool.inputSchema.parse(toolInput));
}

describe("muggle-remote-schedule-update", () => {
  it("puts the editable fields under taskDef", () => {
    const upstreamCall = mapToolInput("muggle-remote-schedule-update", {
      workflowRuntimeId: WORKFLOW_RUNTIME_ID,
      name: "Weekday regression",
      schedule: WEEKDAY_MORNINGS,
      limit: 25,
    });

    expect(upstreamCall.method).toBe("PUT");
    expect(upstreamCall.path).toBe(SCHEDULE_PATH);
    expect(upstreamCall.body).toEqual({
      taskDef: { name: "Weekday regression", schedule: WEEKDAY_MORNINGS, limit: 25 },
    });
  });

  it("pauses with a status alone and no taskDef", () => {
    const upstreamCall = mapToolInput("muggle-remote-schedule-update", {
      workflowRuntimeId: WORKFLOW_RUNTIME_ID,
      status: ScheduleStatusEnum.Paused,
    });

    expect(upstreamCall.body).toEqual({ status: "PAUSED" });
  });

  it.each([
    ["status CANCELLED", { workflowRuntimeId: WORKFLOW_RUNTIME_ID, status: "CANCELLED" }],
    ["status RUNNING", { workflowRuntimeId: WORKFLOW_RUNTIME_ID, status: "RUNNING" }],
    ["no change", { workflowRuntimeId: WORKFLOW_RUNTIME_ID }],
    ["a weekday above 6", { workflowRuntimeId: WORKFLOW_RUNTIME_ID, schedule: { ...WEEKDAY_MORNINGS, daysOfWeek: [7] } }],
    ["no weekdays", { workflowRuntimeId: WORKFLOW_RUNTIME_ID, schedule: { ...WEEKDAY_MORNINGS, daysOfWeek: [] } }],
    ["an hour of 24", { workflowRuntimeId: WORKFLOW_RUNTIME_ID, schedule: { ...WEEKDAY_MORNINGS, time: { hour: 24, minute: 0 } } }],
    ["a non-weekly schedule", { workflowRuntimeId: WORKFLOW_RUNTIME_ID, schedule: { ...WEEKDAY_MORNINGS, type: "daily" } }],
    ["a workflowRuntimeId that is not a UUID", { workflowRuntimeId: "nightly", name: "Nightly" }],
  ])("rejects %s", (_caseName, toolInput) => {
    expect(ScheduleUpdateInputSchema.safeParse(toolInput).success).toBe(false);
  });

  it("never sends intervalSec, which the schedule decides", () => {
    const upstreamCall = mapToolInput("muggle-remote-schedule-update", {
      workflowRuntimeId: WORKFLOW_RUNTIME_ID,
      name: "Nightly",
      intervalSec: 60,
    });

    expect(upstreamCall.body).toEqual({ taskDef: { name: "Nightly" } });
  });
});

describe("muggle-remote-schedule-delete", () => {
  it("deletes the schedule's runtime", () => {
    const upstreamCall = mapToolInput("muggle-remote-schedule-delete", { workflowRuntimeId: WORKFLOW_RUNTIME_ID });

    expect(upstreamCall.method).toBe("DELETE");
    expect(upstreamCall.path).toBe(SCHEDULE_PATH);
    expect(upstreamCall.body).toBeUndefined();
  });

  it("warns that the delete is permanent and asks for confirmation", () => {
    const toolDescription = getQaToolByName("muggle-remote-schedule-delete")!.description;

    expect(toolDescription).toContain("Permanently delete");
    expect(toolDescription).toContain("Confirm with the user first");
  });
});
