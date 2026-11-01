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
