import { z } from "zod";

import { MuggleEntityIdSchema } from "../../contracts/muggle-entity-id-schema.js";
import { WORKFLOW_RUNTIME_ID_NOT_RUN_ID_HINT } from "./constants.js";
import { ScheduleDayOfWeekEnum, ScheduleStatusEnum, ScheduleTypeEnum } from "./schedule-types.js";

const ScheduleWorkflowRuntimeIdSchema = MuggleEntityIdSchema.describe(
  `Bulk replay workflow runtime ID (UUID) of the schedule, from muggle-remote-wf-list-ts-replay-bulk-runtimes. ${WORKFLOW_RUNTIME_ID_NOT_RUN_ID_HINT}`,
);

const ScheduleTimeOfDaySchema = z.object({
  hour: z.number().int().min(0).max(23).describe("Hour, 0–23"),
  minute: z.number().int().min(0).max(59).describe("Minute, 0–59"),
});

/** A weekly schedule in the prompt-service wire shape. */
export const WeeklyScheduleSchema = z.object({
  type: z.literal(ScheduleTypeEnum.Weekly),
  daysOfWeek: z
    .array(z.enum(ScheduleDayOfWeekEnum))
    .min(1)
    .describe("Weekdays to run on: 0 is Sunday through 6 Saturday"),
  time: ScheduleTimeOfDaySchema.describe("Time of day to run"),
  times: z
    .array(ScheduleTimeOfDaySchema)
    .optional()
    .describe("Several times of day to run, e.g. 9:00 and 15:00; when set, these are used instead of time"),
  timezone: z.string().min(1).optional().describe("IANA timezone, e.g. 'America/Los_Angeles'; UTC when omitted"),
});

/** Input of muggle-remote-schedule-update; at least one change is required. */
export const ScheduleUpdateInputSchema = z
  .object({
    workflowRuntimeId: ScheduleWorkflowRuntimeIdSchema,
    name: z.string().min(1).optional().describe("New schedule name"),
    schedule: WeeklyScheduleSchema.optional().describe(
      "Replaces the whole stored schedule; the run interval is derived from it",
    ),
    namePrefix: z.string().min(1).optional().describe("New prefix for the names of the runs it starts"),
    limit: z.number().int().positive().optional().describe("Most test cases each run replays"),
    repeatPerTestCase: z.number().int().positive().optional().describe("Parallel runs per test case"),
    status: z
      .enum(ScheduleStatusEnum)
      .optional()
      .describe("PAUSED pauses an ACTIVE schedule; ACTIVE resumes a PAUSED one"),
  })
  .refine(
    (scheduleUpdate) =>
      scheduleUpdate.name !== undefined ||
      scheduleUpdate.schedule !== undefined ||
      scheduleUpdate.namePrefix !== undefined ||
      scheduleUpdate.limit !== undefined ||
      scheduleUpdate.repeatPerTestCase !== undefined ||
      scheduleUpdate.status !== undefined,
    { message: "Pass at least one of name, schedule, namePrefix, limit, repeatPerTestCase or status" },
  );

/** Input of muggle-remote-schedule-delete. */
export const ScheduleDeleteInputSchema = z.object({
  workflowRuntimeId: ScheduleWorkflowRuntimeIdSchema,
});
