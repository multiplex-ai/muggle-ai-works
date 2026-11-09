/**
 * Translates a test case's resolutions between the MCP surface (a resolution list, kept feature flags, a
 * run strategy) and its lane test spec on the backend, whose displayResolution axis lists one value set
 * per resolution and whose runSettings records are what generation and runs execute under.
 */

import type { z } from "zod";

import type {
  TestCaseDisplayResolutionsGetInputSchema,
  TestCaseDisplayResolutionsUpdateInputSchema,
} from "../../e2e/contracts/index.js";
import { RunEnvironment } from "../../e2e/contracts/run-environment.js";
import { GatewayError, McpErrorCode, type IUpstreamResponse } from "../../e2e/types.js";
import type { DisplayResolution } from "../../local/types/enums.js";
import { toRunStrategy } from "./project-display-resolutions-transform.js";
import { toRunSettingsListRow } from "./run-settings-list-transform.js";
import type {
  IRawTestCaseTestSpecEnvelope,
  ITestCaseDisplayResolutionsOutput,
  ITestCaseRunSettingsRow,
  ITestSpecCommitBody,
} from "./test-case-display-resolutions-transform-types.js";
import { MUGGLE_TEST_PREFIX } from "./upstream-route-constants.js";

/** Path of a test case's test spec; the commit route is this path plus `/commit`. */
export function buildTestCaseTestSpecPath(params: { projectId: string; testCaseId: string }): string {
  return `${MUGGLE_TEST_PREFIX}/projects/${params.projectId}/test-cases/${params.testCaseId}/test-spec`;
}

/**
 * Builds the commit body that sets a test case's resolutions on a lane: one displayResolution value set
 * per resolution, deduplicated in order, the kept feature-flag variants, and the run strategy as
 * `fanOutPolicy`. Feature flags and the run strategy are left off when not passed.
 *
 * Output shape: `{ laneType: "remote", axes: { displayResolution: [["R_0390x0844"]] }, fanOutPolicy: "primaryOnly" }`
 */
export function buildTestSpecCommitBody(
  input: z.infer<typeof TestCaseDisplayResolutionsUpdateInputSchema>,
): ITestSpecCommitBody {
  const body: ITestSpecCommitBody = {
    laneType: input.runEnvironmentType ?? RunEnvironment.Remote,
    axes: {
      displayResolution: [...new Set(input.displayResolutions)].map((displayResolution) => [displayResolution]),
      ...(input.featureFlags !== undefined && { featureFlags: input.featureFlags }),
    },
  };
  if (input.runStrategy !== undefined) {
    body.fanOutPolicy = input.runStrategy;
  }
  return body;
}

/**
 * Maps a test case's lane test spec to the resolutions it runs at, primary first, with its records.
 *
 * Output shape: `{ projectId: "…", testCaseId: "…", runEnvironmentType: "remote", hasOwnTestSpec: true, displayResolutions: ["R_0390x0844"], primaryResolution: "R_0390x0844", featureFlags: null, runStrategy: "primaryOnly", runSettingsList: [{ runSettingsId: "7c1e…", resolutionLabel: "390×844", displayResolution: "R_0390x0844", isPrimary: true }] }`
 *
 * @throws GatewayError when the upstream body carries no `runSettingsList` array.
 */
export function mapTestCaseDisplayResolutions(
  response: IUpstreamResponse,
  input?: unknown,
): ITestCaseDisplayResolutionsOutput {
  const toolInput = input as z.infer<typeof TestCaseDisplayResolutionsGetInputSchema>;
  const envelope = response.data as IRawTestCaseTestSpecEnvelope | null | undefined;
  if (!Array.isArray(envelope?.runSettingsList)) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message: "test spec response carried no runSettingsList array.",
      statusCode: response.statusCode,
    });
  }
  const runSettingsRows: ITestCaseRunSettingsRow[] = envelope.runSettingsList.map((runSettings) => ({
    ...toRunSettingsListRow(runSettings),
    isPrimary: runSettings.id === envelope.primaryRunSettingsId,
  }));
  const primaryRows = runSettingsRows.filter((row) => row.isPrimary);
  const primaryFirstRows = [...primaryRows, ...runSettingsRows.filter((row) => !row.isPrimary)];
  const featureFlags = envelope.testSpec?.axes?.featureFlags;
  return {
    projectId: toolInput.projectId,
    testCaseId: toolInput.testCaseId,
    runEnvironmentType: toolInput.runEnvironmentType ?? RunEnvironment.Remote,
    hasOwnTestSpec: Boolean(envelope.testSpec),
    displayResolutions: [
      ...new Set(
        primaryFirstRows
          .map((row) => row.displayResolution)
          .filter((displayResolution): displayResolution is DisplayResolution => displayResolution !== undefined),
      ),
    ],
    primaryResolution: primaryRows[0]?.displayResolution ?? null,
    featureFlags: featureFlags && featureFlags.length > 0 ? featureFlags : null,
    runStrategy: toRunStrategy(envelope.effectiveFanOutPolicy),
    runSettingsList: runSettingsRows,
  };
}
