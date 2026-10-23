/**
 * Layer 1 of the skill-gate eval: static contract lint.
 *
 * Pins the telemetry event catalog to the `muggle-local-telemetry-event-emit`
 * input schema. A catalog doc naming an event type the tool rejects tells every
 * skill that follows it to make a call that fails validation; a workflow event
 * type with no doc leaves its payload undocumented.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { localQa } from "@muggleai/mcp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const SHARED_DIR = path.join(REPO_ROOT, "plugin", "skills", "_shared");
const EVENT_DOCS_DIR = path.join(SHARED_DIR, "telemetry-events");
const PR_FOLLOWUP_FIXTURES_DIR = path.join(REPO_ROOT, "internal", "skills", "pr-followup-fixtures");

const workflowEventTypes: string[] = Object.values(localQa.WorkflowEventType);
const catalogIndex = fs.readFileSync(path.join(SHARED_DIR, "telemetry-events.md"), "utf8");
const eventDocPaths = fs
  .readdirSync(EVENT_DOCS_DIR)
  .filter((fileName) => fileName.endsWith(".md"))
  .map((fileName) => path.join(EVENT_DOCS_DIR, fileName));

interface IDocumentedEventCall {
  heading?: string;
  eventType?: string;
  skillName?: string;
  hasLegacyEnvelope: boolean;
}

function readDocumentedEventCall(eventDocPath: string): IDocumentedEventCall {
  const eventDoc = fs.readFileSync(eventDocPath, "utf8");
  return {
    heading: eventDoc.match(/^# `([^`]+)`$/m)?.[1],
    eventType: eventDoc.match(/"eventType": "([^"]+)"/)?.[1],
    skillName: eventDoc.match(/"skillName": "([^"]+)"/)?.[1],
    hasLegacyEnvelope: /"skill":|"event":/.test(eventDoc),
  };
}

function listFixturePaths(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFixturePaths(entryPath);
    return entry.name.endsWith(".json") ? [entryPath] : [];
  });
}

describe("telemetry event catalog", () => {
  it.each(eventDocPaths.map((eventDocPath) => [path.basename(eventDocPath), eventDocPath]))(
    "%s documents a call the event-emit tool accepts",
    (_fileName, eventDocPath) => {
      const documentedCall = readDocumentedEventCall(eventDocPath);
      expect(workflowEventTypes).toContain(documentedCall.eventType);
      expect(documentedCall.heading).toBe(documentedCall.eventType);
      expect(documentedCall.eventType?.startsWith(`${documentedCall.skillName}:`)).toBe(true);
      expect(documentedCall.hasLegacyEnvelope).toBe(false);
    },
  );

  it.each(workflowEventTypes)("indexes and documents the workflow event %s", (eventType) => {
    expect(catalogIndex).toContain(`[\`${eventType}\`]`);
    expect(eventDocPaths.map((eventDocPath) => readDocumentedEventCall(eventDocPath).eventType)).toContain(eventType);
  });
});

describe("pr-followup fixtures", () => {
  const fixtureEvents = listFixturePaths(PR_FOLLOWUP_FIXTURES_DIR).flatMap((fixturePath) => {
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as { expected?: { telemetry_events?: unknown[] } };
    return (fixture.expected?.telemetry_events ?? []).map((telemetryEvent, eventIndex) => [
      `${path.relative(PR_FOLLOWUP_FIXTURES_DIR, fixturePath)}#${eventIndex}`,
      telemetryEvent,
    ]);
  });

  it("carry telemetry events to check", () => {
    expect(fixtureEvents.length).toBeGreaterThan(0);
  });

  it.each(fixtureEvents)("%s is a valid event-emit call", (_eventLabel, telemetryEvent) => {
    const parsedEvent = localQa.EventTelemetryEmitInputSchema.safeParse(telemetryEvent);
    expect(parsedEvent.success).toBe(true);
    expect(workflowEventTypes).toContain(parsedEvent.data?.eventType);
  });
});
