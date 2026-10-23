/**
 * Records skill telemetry events in the local log that owns each event type.
 */

import { appendFailureEvent, appendWorkflowEvent } from "../../../shared/telemetry-event-log.js";
import { WorkflowEventType, type EventTelemetryEmitInput } from "../contracts/telemetry-schemas.js";

/**
 * Records one `muggle-local-telemetry-event-emit` event. A workflow event keeps only its catalog
 * payload; a failure-mode event keeps its classification fields. Never throws.
 * @param telemetryEvent - The validated tool input.
 */
export function recordTelemetryEvent(telemetryEvent: EventTelemetryEmitInput): void {
  if (isWorkflowEventType(telemetryEvent.eventType)) {
    appendWorkflowEvent({
      eventType: telemetryEvent.eventType,
      skillName: telemetryEvent.skillName,
      metadata: telemetryEvent.metadata,
    });
    return;
  }

  appendFailureEvent({
    eventType: telemetryEvent.eventType,
    skillName: telemetryEvent.skillName,
    aiClassification: telemetryEvent.aiClassification,
    aiSuggestion: telemetryEvent.aiSuggestion,
    userAction: telemetryEvent.userAction,
    runId: telemetryEvent.runId,
    testCaseId: telemetryEvent.testCaseId,
    projectId: telemetryEvent.projectId,
    signals: telemetryEvent.signals,
    metadata: telemetryEvent.metadata,
  });
}

function isWorkflowEventType(eventType: EventTelemetryEmitInput["eventType"]): eventType is WorkflowEventType {
  return (Object.values(WorkflowEventType) as string[]).includes(eventType);
}
