import type { DisplayParams } from "../../local/types/display-types.js";
import type { DisplayResolution } from "../../local/types/enums.js";

/** One runSettings record as `GET /projects/:projectId/test-cases/:testCaseId/run-settings` returns it. */
export interface IRawRunSettings {
  id: string;
  displayParams?: DisplayParams;
  featureFlags?: Record<string, unknown>;
}

/** Body of `GET /projects/:projectId/test-cases/:testCaseId/run-settings`. */
export interface IRawRunSettingsListEnvelope {
  runSettingsList?: IRawRunSettings[];
}

/** One runSettings record as muggle-remote-run-settings-list returns it. */
export interface IRunSettingsListRow {
  runSettingsId: string;
  /** Window size as `<width>×<height>`, the label an E2E report entry carries for the record. */
  resolutionLabel?: string;
  /** The `displayResolution` the local execute tools take for this size; absent when no value matches it. */
  displayResolution?: DisplayResolution;
  featureFlags?: Record<string, unknown>;
}

/** Output of muggle-remote-run-settings-list. */
export interface IRunSettingsListOutput {
  runSettingsList: IRunSettingsListRow[];
}
