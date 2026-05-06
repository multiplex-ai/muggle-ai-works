/**
 * Zod schemas for client telemetry tools.
 */

import { z } from "zod";

// Trigger source for a skill invocation; mirrors the Trigger union in the
// telemetry events package.
export const SkillTelemetryEmitInputSchema = z.object({
    skillName: z.string().min(1).describe("Name of the skill being invoked, e.g. 'muggle-test'."),
    trigger: z
        .enum(["user-slash", "claude-proactive", "nested-skill"])
        .default("user-slash")
        .describe("Why this skill ran. Defaults to 'user-slash' (user typed /skill-name)."),
});

export type SkillTelemetryEmitInput = z.infer<typeof SkillTelemetryEmitInputSchema>;
