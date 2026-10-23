/**
 * Zod schemas for client telemetry tools.
 */

import { Trigger } from "@muggleai/telemetry";
import { z } from "zod";

export const SkillTelemetryEmitInputSchema = z.object({
    skillName: z.string().min(1).describe("Name of the skill being invoked, e.g. 'muggle-test'."),
    trigger: z
        .nativeEnum(Trigger)
        .default(Trigger.UserSlash)
        .describe("Why this skill ran. Defaults to 'user-slash' (user typed /skill-name)."),
});

export type SkillTelemetryEmitInput = z.infer<typeof SkillTelemetryEmitInputSchema>;

/** Failure-mode decision points from `plugin/skills/_shared/failure-mode-handling.md`. */
export enum FailureEventType {
    PreExecutionClassification = "pre-execution-classification",
    ReplayFailureClassified = "replay-failure-classified",
    ReplayFailureResolved = "replay-failure-resolved",
    RegenFailureClassified = "regen-failure-classified",
    RegenFailureResolved = "regen-failure-resolved",
}

/** Skill workflow events from the telemetry catalog (`plugin/skills/_shared/telemetry-events.md`), named `<skill>:<event>`. */
export enum WorkflowEventType {
    MuggleDoCycle = "muggle-do:cycle",
    MuggleDoEscalation = "muggle-do:escalation",
    MuggleDoResolveReminder = "muggle-do:resolve-reminder",
    PrFollowupTick = "muggle-pr-followup:tick",
    PrFollowupBootstrap = "muggle-pr-followup:bootstrap",
}

export const EventTelemetryEmitInputSchema = z.object({
    eventType: z
        .union([z.nativeEnum(FailureEventType), z.nativeEnum(WorkflowEventType)])
        .describe(
            "What this event records: a failure-mode decision point (the pre-execution replay-vs-regen " +
            "choice or a classify→resolve pair) or a skill workflow event from the telemetry catalog.",
        ),
    skillName: z
        .string()
        .min(1)
        .describe("Skill that emitted this event (e.g. 'muggle-test', 'muggle-test-feature-local')."),
    aiClassification: z
        .string()
        .optional()
        .describe(
            "What the AI classified the situation as. " +
            "pre-execution: 'replay' or 'regen'. " +
            "replay-failure: 'infra' | 'stale-script' | 'product-defect'. " +
            "regen-failure: 'transient' | 'infra' | 'agent-course' | 'product-uxux'.",
        ),
    aiSuggestion: z
        .string()
        .optional()
        .describe(
            "What the AI suggested the user do. Examples: 'regenerate', 'report-bug', " +
            "'muggle-feedback', 'retry', 'wait-and-share'.",
        ),
    userAction: z
        .string()
        .optional()
        .describe(
            "What the user actually picked (only set on *-resolved events). " +
            "Compare against aiSuggestion to measure classification accuracy.",
        ),
    runId: z.string().optional().describe("Anchor: local run ID for the affected execution."),
    testCaseId: z.string().optional().describe("Anchor: cloud test case ID."),
    projectId: z.string().optional().describe("Anchor: cloud project ID."),
    signals: z
        .array(z.string())
        .optional()
        .describe(
            "Signals that drove the classification, e.g. ['element-not-found', 'selector-timeout', " +
            "'electron-exit-26', 'goal-not-achievable']. Used to refine the rules later.",
        ),
    metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Free-form additional context (e.g. error excerpt). A workflow event's catalog payload goes here."),
});

export type EventTelemetryEmitInput = z.infer<typeof EventTelemetryEmitInputSchema>;
