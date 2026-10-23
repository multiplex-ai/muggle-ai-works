/** Tests for muggle-local-telemetry-event-emit: which events it accepts and which local log records each. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const dataDirState = vi.hoisted(() => ({ path: "" }));

vi.mock("../shared/data-dir.js", () => ({
  getDataDir: () => dataDirState.path,
}));

// Load the real tool registry without the package.json muggleConfig / cloud
// client / auth side effects (same stubs as mcp-tool-surface.test.ts).
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
  const fake = { info: noop, warn: noop, error: noop, debug: noop, verbose: noop, silly: noop, child: () => fake };
  return { getLogger: () => fake, createChildLogger: () => fake, resetLogger: noop };
});

vi.mock("../mcp/e2e/upstream-client.js", () => ({ getPromptServiceClient: () => ({ execute: vi.fn() }) }));

vi.mock("../shared/auth.js", () => ({
  getCallerCredentialsAsync: vi.fn(async () => ({ bearerToken: "test-token" })),
}));

vi.mock("@muggleai/telemetry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@muggleai/telemetry")>()),
  track: vi.fn(),
}));

import {
  EventTelemetryEmitInputSchema,
  FailureEventType,
  WorkflowEventType,
} from "../mcp/local/contracts/index.js";
import { executeTool } from "../mcp/tools/local/tool-registry.js";
import { getFailureEventsFilePath, getWorkflowEventsFilePath } from "../shared/telemetry-event-log.js";

const EVENT_EMIT_TOOL_NAME = "muggle-local-telemetry-event-emit";
const CORRELATION_ID = "8f0c2a4e-6b1d-4c3e-9a7f-2d5e8b1c0f63";

const cyclePayload = {
  session_slug: "acme-widget-pr142",
  repo: "acme/widget",
  pr_number: 142,
  review_ids_in: [4295962900, 4295962950],
  outcome: "mixed",
};

function readLoggedEvents(filePath: string): Array<Record<string, unknown>> {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(() => {
  dataDirState.path = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-telemetry-"));
});

afterEach(() => {
  fs.rmSync(dataDirState.path, { recursive: true, force: true });
});

describe("telemetry event-emit input schema", () => {
  it.each(Object.values(WorkflowEventType))("accepts the workflow event %s", (eventType) => {
    expect(EventTelemetryEmitInputSchema.safeParse({ eventType: eventType, skillName: "muggle-do" }).success).toBe(true);
  });

  it.each(Object.values(FailureEventType))("accepts the failure-mode event %s", (eventType) => {
    expect(EventTelemetryEmitInputSchema.safeParse({ eventType: eventType, skillName: "muggle-test" }).success).toBe(true);
  });

  it.each(["cycle", "muggle-do:unknown"])("rejects the unknown event %s", (eventType) => {
    expect(EventTelemetryEmitInputSchema.safeParse({ eventType: eventType, skillName: "muggle-do" }).success).toBe(false);
  });
});

describe("muggle-local-telemetry-event-emit", () => {
  it("records a workflow event's catalog payload in the workflow log only", async () => {
    const toolResult = await executeTool(
      EVENT_EMIT_TOOL_NAME,
      { eventType: WorkflowEventType.MuggleDoCycle, skillName: "muggle-do", metadata: cyclePayload },
      CORRELATION_ID,
    );

    expect(toolResult.isError).toBe(false);
    const workflowEvents = readLoggedEvents(getWorkflowEventsFilePath());
    expect(workflowEvents).toHaveLength(1);
    expect(workflowEvents[0]).toMatchObject({
      eventType: "muggle-do:cycle",
      skillName: "muggle-do",
      metadata: cyclePayload,
    });
    expect(Number.isNaN(Date.parse(String(workflowEvents[0].ts)))).toBe(false);
    expect(readLoggedEvents(getFailureEventsFilePath())).toEqual([]);
  });

  it("keeps a workflow event to its payload, without failure-mode classification fields", async () => {
    await executeTool(
      EVENT_EMIT_TOOL_NAME,
      {
        eventType: WorkflowEventType.PrFollowupTick,
        skillName: "muggle-pr-followup",
        aiClassification: "infra",
        runId: "run-1",
        metadata: { idle: true },
      },
      CORRELATION_ID,
    );

    const [tickEvent] = readLoggedEvents(getWorkflowEventsFilePath());
    expect(Object.keys(tickEvent).sort()).toEqual(["eventType", "metadata", "skillName", "ts"]);
  });

  it("records a failure-mode event with its classification in the failure log only", async () => {
    const toolResult = await executeTool(
      EVENT_EMIT_TOOL_NAME,
      {
        eventType: FailureEventType.ReplayFailureClassified,
        skillName: "muggle-test",
        aiClassification: "stale-script",
        aiSuggestion: "regenerate",
        runId: "run-7",
        signals: ["element-not-found"],
      },
      CORRELATION_ID,
    );

    expect(toolResult.isError).toBe(false);
    expect(readLoggedEvents(getFailureEventsFilePath())).toEqual([
      expect.objectContaining({
        eventType: "replay-failure-classified",
        skillName: "muggle-test",
        aiClassification: "stale-script",
        aiSuggestion: "regenerate",
        runId: "run-7",
        signals: ["element-not-found"],
      }),
    ]);
    expect(readLoggedEvents(getWorkflowEventsFilePath())).toEqual([]);
  });

  it("never fails the skill when the telemetry log cannot be written", async () => {
    // A file where the telemetry folder belongs makes every append throw.
    fs.writeFileSync(path.dirname(getWorkflowEventsFilePath()), "");

    const toolResult = await executeTool(
      EVENT_EMIT_TOOL_NAME,
      { eventType: WorkflowEventType.MuggleDoEscalation, skillName: "muggle-do", metadata: { kind: "e2e-unrepairable" } },
      CORRELATION_ID,
    );

    expect(toolResult.isError).toBe(false);
  });
});
