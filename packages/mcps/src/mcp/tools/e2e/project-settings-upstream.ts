/**
 * Upstream paths and request bodies of the project settings tools: workflow config, schedules, feature flags,
 * run settings, integrations, access, report generation and pins.
 */

import type { z } from "zod";

import type {
  ProjectFeatureFlagsUpdateInputSchema,
  ProjectWorkflowConfigUpdateInputSchema,
  ScheduleUpdateInputSchema,
} from "../../e2e/contracts/index.js";
import { RunEnvironment } from "../../e2e/contracts/run-environment.js";
import { MUGGLE_TEST_PREFIX, REPORT_GENERATION_WORKFLOWS_PATH } from "./upstream-route-constants.js";

/**
 * Builds the path of a project's workflow config.
 * @param projectId - Project ID.
 * @returns e.g. `/v1/protected/muggle-test/workflow-config/project/<projectId>`.
 */
export function buildProjectWorkflowConfigPath(projectId: string): string {
  return `${MUGGLE_TEST_PREFIX}/workflow-config/project/${projectId}`;
}

/**
 * Builds a project workflow config write body. Only the groups the input touches are sent, because the backend
 * replaces each sent group whole and keeps the others; a null model tier sends an empty `llm` to clear it.
 *
 * Output shape: `{ workflowParams: { llm: { tier: "light" }, memory: { enableEverMemOS: false } } }`
 *
 * @param configUpdate - Tool input already validated by its schema.
 */
export function buildProjectWorkflowConfigUpdateBody(
  configUpdate: z.infer<typeof ProjectWorkflowConfigUpdateInputSchema>,
): Record<string, unknown> {
  const workflowParams: Record<string, unknown> = {};
  if (configUpdate.modelTier !== undefined) {
    workflowParams.llm = configUpdate.modelTier === null ? {} : { tier: configUpdate.modelTier };
  }
  if (configUpdate.enableSharedTestMemory !== undefined || configUpdate.enableEverMemOS !== undefined) {
    const memoryParams: Record<string, boolean> = {};
    if (configUpdate.enableSharedTestMemory !== undefined) {
      memoryParams.enableSharedTestMemory = configUpdate.enableSharedTestMemory;
    }
    if (configUpdate.enableEverMemOS !== undefined) memoryParams.enableEverMemOS = configUpdate.enableEverMemOS;
    workflowParams.memory = memoryParams;
  }
  if (configUpdate.maxRunTimeMs !== undefined) workflowParams.maxRunTimeMs = configUpdate.maxRunTimeMs;
  return { workflowParams: workflowParams };
}

/**
 * Builds the path of one bulk replay schedule.
 * @param workflowRuntimeId - The schedule's workflow runtime ID.
 * @returns e.g. `/v1/protected/muggle-test/workflow/test-script/test-script-replay/bulk/<workflowRuntimeId>`.
 */
export function buildScheduleRuntimePath(workflowRuntimeId: string): string {
  return `${MUGGLE_TEST_PREFIX}/workflow/test-script/test-script-replay/bulk/${workflowRuntimeId}`;
}

/**
 * Builds a schedule update body: the editable task definition fields the input sets, and the status.
 *
 * Output shape: `{ taskDef: { name: "Nightly", schedule: { type: "weekly", daysOfWeek: [1], time: { hour: 9, minute: 0 } } }, status: "PAUSED" }`
 *
 * @param scheduleUpdate - Tool input already validated by its schema.
 */
export function buildScheduleUpdateBody(
  scheduleUpdate: z.infer<typeof ScheduleUpdateInputSchema>,
): Record<string, unknown> {
  const taskDef: Record<string, unknown> = {};
  if (scheduleUpdate.name !== undefined) taskDef.name = scheduleUpdate.name;
  if (scheduleUpdate.schedule !== undefined) taskDef.schedule = scheduleUpdate.schedule;
  if (scheduleUpdate.namePrefix !== undefined) taskDef.namePrefix = scheduleUpdate.namePrefix;
  if (scheduleUpdate.limit !== undefined) taskDef.limit = scheduleUpdate.limit;
  if (scheduleUpdate.repeatPerTestCase !== undefined) taskDef.repeatPerTestCase = scheduleUpdate.repeatPerTestCase;
  const body: Record<string, unknown> = {};
  if (Object.keys(taskDef).length > 0) body.taskDef = taskDef;
  if (scheduleUpdate.status !== undefined) body.status = scheduleUpdate.status;
  return body;
}

/**
 * Builds the path of a project's test spec, the per-lane axis values.
 * @param projectId - Project ID.
 * @returns e.g. `/v1/protected/muggle-test/projects/<projectId>/project-test-spec`.
 */
export function buildProjectTestSpecPath(projectId: string): string {
  return `${MUGGLE_TEST_PREFIX}/projects/${projectId}/project-test-spec`;
}

/**
 * Builds a project test spec edit body that changes the feature flags axis only; omitted fields carry forward.
 *
 * Output shape: `{ laneType: "remote", perAxis: { featureFlags: { enabledValues: ["beta"], default: [] } } }`
 *
 * @param featureFlagsUpdate - Tool input already validated by its schema.
 */
export function buildFeatureFlagsUpdateBody(
  featureFlagsUpdate: z.infer<typeof ProjectFeatureFlagsUpdateInputSchema>,
): Record<string, unknown> {
  const featureFlagsAxis: Record<string, unknown> = {};
  if (featureFlagsUpdate.enabledValues !== undefined) featureFlagsAxis.enabledValues = featureFlagsUpdate.enabledValues;
  if (featureFlagsUpdate.defaultValues !== undefined) featureFlagsAxis.default = featureFlagsUpdate.defaultValues;
  if (featureFlagsUpdate.valueGroups !== undefined) featureFlagsAxis.valueGroups = featureFlagsUpdate.valueGroups;
  return {
    laneType: featureFlagsUpdate.runEnvironmentType ?? RunEnvironment.Remote,
    perAxis: { featureFlags: featureFlagsAxis },
  };
}

/**
 * Builds the path of a project's run settings, the per-lane managed profile, secrets and workflow files.
 * @param projectId - Project ID.
 * @returns e.g. `/v1/protected/muggle-test/projects/<projectId>/run-settings`.
 */
export function buildProjectRunSettingsPath(projectId: string): string {
  return `${MUGGLE_TEST_PREFIX}/projects/${projectId}/run-settings`;
}

/**
 * Builds the path of a project's access grants.
 * @param projectId - Project ID.
 * @returns e.g. `/v1/protected/muggle-test/projects/<projectId>/access`.
 */
export function buildProjectAccessPath(projectId: string): string {
  return `${MUGGLE_TEST_PREFIX}/projects/${projectId}/access`;
}

/**
 * Builds the path of a project's GitHub connection.
 * @param projectId - Project ID.
 * @returns e.g. `/v1/protected/muggle-test/projects/<projectId>/github`.
 */
export function buildProjectGithubPath(projectId: string): string {
  return `${MUGGLE_TEST_PREFIX}/projects/${projectId}/github`;
}

/**
 * Builds the path of one report generation workflow.
 * @param workflowId - Report generation workflow ID.
 * @returns e.g. `/v1/protected/muggle-test/workflow/report-generation/<workflowId>`.
 */
export function buildReportGenerationWorkflowPath(workflowId: string): string {
  return `${REPORT_GENERATION_WORKFLOWS_PATH}/${workflowId}`;
}

/**
 * Builds the path pinning a project to the caller's project list.
 * @param projectId - Project ID.
 * @returns e.g. `/v1/protected/muggle-test/projects/<projectId>/pin`.
 */
export function buildProjectPinPath(projectId: string): string {
  return `${MUGGLE_TEST_PREFIX}/projects/${projectId}/pin`;
}
