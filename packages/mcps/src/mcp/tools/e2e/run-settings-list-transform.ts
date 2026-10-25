/**
 * Slims a test case's runSettings records to what a skill needs to name one: its id, its window
 * size and its feature flags, leaving out managed profiles, secret bindings and spec bookkeeping.
 */

import { GatewayError, McpErrorCode, type IUpstreamResponse } from "../../e2e/types.js";
import { DISPLAY_PARAMS_BY_RESOLUTION } from "../../local/services/display-resolution-constants.js";
import type { DisplayParams } from "../../local/types/display-types.js";
import type { DisplayResolution } from "../../local/types/enums.js";
import type {
  IRawRunSettings,
  IRawRunSettingsListEnvelope,
  IRunSettingsListOutput,
  IRunSettingsListRow,
} from "./run-settings-list-transform-types.js";

/**
 * Maps a test case's runSettings records in one lane to one row each.
 *
 * Output shape: `{ runSettingsList: [{ runSettingsId: "7c1e…", resolutionLabel: "390×844", displayResolution: "R_0390x0844", featureFlags: { custom: { beta: true } } }] }`
 *
 * @throws GatewayError when the upstream body carries no `runSettingsList` array.
 */
export function mapRunSettingsList(response: IUpstreamResponse): IRunSettingsListOutput {
  const envelope = response.data as IRawRunSettingsListEnvelope | undefined;
  if (!Array.isArray(envelope?.runSettingsList)) {
    throw new GatewayError({
      code: McpErrorCode.UPSTREAM_ERROR,
      message: "runSettings list response carried no runSettingsList array.",
      statusCode: response.statusCode,
    });
  }
  return { runSettingsList: envelope.runSettingsList.map(toRunSettingsListRow) };
}

function toRunSettingsListRow(runSettings: IRawRunSettings): IRunSettingsListRow {
  const displayParams = runSettings.displayParams;
  const displayResolution = displayParams ? findDisplayResolution(displayParams) : undefined;
  return {
    runSettingsId: runSettings.id,
    ...(displayParams && {
      resolutionLabel: `${displayParams.browserWindowWidth}×${displayParams.browserWindowHeight}`,
    }),
    ...(displayResolution && { displayResolution: displayResolution }),
    ...(runSettings.featureFlags && { featureFlags: runSettings.featureFlags }),
  };
}

function findDisplayResolution(displayParams: DisplayParams): DisplayResolution | undefined {
  const matchingEntry = Object.entries(DISPLAY_PARAMS_BY_RESOLUTION).find(
    ([, resolutionDisplayParams]) =>
      resolutionDisplayParams.browserWindowWidth === displayParams.browserWindowWidth &&
      resolutionDisplayParams.browserWindowHeight === displayParams.browserWindowHeight,
  );
  return matchingEntry?.[0] as DisplayResolution | undefined;
}
