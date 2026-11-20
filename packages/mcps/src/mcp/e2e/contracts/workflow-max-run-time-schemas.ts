import { z } from "zod";

import {
  MAX_WORKFLOW_MAX_RUN_TIME_OVERRIDE_MS,
  MIN_WORKFLOW_MAX_RUN_TIME_OVERRIDE_MS,
} from "../../../shared/workflow-max-run-time-constants.js";
import { WorkflowMaxRunTimeTypeEnum } from "../../../shared/workflow-max-run-time-types.js";

const WorkflowMaxRunTimeMsSchema = z
  .number()
  .int()
  .min(MIN_WORKFLOW_MAX_RUN_TIME_OVERRIDE_MS)
  .max(MAX_WORKFLOW_MAX_RUN_TIME_OVERRIDE_MS)
  .optional();

/** Optional max runtime overrides in workflow params, keyed by workflow kind. */
export const WorkflowMaxRunTimeParamsSchema = z.object({
  [WorkflowMaxRunTimeTypeEnum.WebsiteScan]: WorkflowMaxRunTimeMsSchema,
  [WorkflowMaxRunTimeTypeEnum.TestScriptGeneration]: WorkflowMaxRunTimeMsSchema,
  [WorkflowMaxRunTimeTypeEnum.TestScriptGenerationBulk]: WorkflowMaxRunTimeMsSchema,
  [WorkflowMaxRunTimeTypeEnum.TestScriptReplay]: WorkflowMaxRunTimeMsSchema,
  [WorkflowMaxRunTimeTypeEnum.TestScriptReplayBulk]: WorkflowMaxRunTimeMsSchema,
  [WorkflowMaxRunTimeTypeEnum.ReportGeneration]: WorkflowMaxRunTimeMsSchema,
}).strict();
