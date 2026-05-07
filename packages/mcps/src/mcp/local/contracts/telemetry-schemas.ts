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
