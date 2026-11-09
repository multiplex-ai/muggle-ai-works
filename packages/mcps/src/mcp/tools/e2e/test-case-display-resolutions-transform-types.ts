import type { z } from "zod";

import type { TestSpecFeatureFlagVariantSchema } from "../../e2e/contracts/index.js";
import type { RunEnvironment } from "../../e2e/contracts/run-environment.js";
import type { RunStrategy } from "../../e2e/contracts/run-strategy-types.js";
import type { DisplayResolution } from "../../local/types/enums.js";
import type { IRawRunSettings, IRunSettingsListRow } from "./run-settings-list-transform-types.js";

/** One feature-flag variant of a test spec: a raw flag set or a project value-group reference. */
export type TestSpecFeatureFlagVariant = z.infer<typeof TestSpecFeatureFlagVariantSchema>;

/**
 * Body of `GET /projects/:projectId/test-cases/:testCaseId/test-spec`. `testSpec` is null for a test case
 * that never had its own spec on the lane; `effectiveFanOutPolicy` is the strategy its runs start under.
 */
export interface IRawTestCaseTestSpecEnvelope {
  testSpec?: {
    axes?: {
      featureFlags?: TestSpecFeatureFlagVariant[];
    };
  } | null;
  runSettingsList?: IRawRunSettings[];
  primaryRunSettingsId?: string | null;
  effectiveFanOutPolicy?: string;
}

/** Body of `POST /projects/:projectId/test-cases/:testCaseId/test-spec/commit`. */
export interface ITestSpecCommitBody {
  laneType: RunEnvironment;
  axes: {
    displayResolution: DisplayResolution[][];
    featureFlags?: TestSpecFeatureFlagVariant[];
  };
  fanOutPolicy?: RunStrategy | null;
}

/** One runSettings record of the test case, flagged when it is the one verified first. */
export interface ITestCaseRunSettingsRow extends IRunSettingsListRow {
  isPrimary: boolean;
}

/** Output of muggle-remote-test-case-display-resolutions-get and -update. */
export interface ITestCaseDisplayResolutionsOutput {
  projectId: string;
  testCaseId: string;
  runEnvironmentType: RunEnvironment;
  /** False when the test case has no spec of its own on the lane and runs at the project lane's resolutions. */
  hasOwnTestSpec: boolean;
  /** Resolutions the test case runs at, primary first. */
  displayResolutions: DisplayResolution[];
  /** Resolution verified first; null when the primary record's size matches no resolution this MCP version knows. */
  primaryResolution: DisplayResolution | null;
  /** The spec's feature-flag variants, to pass back on an update; null when it selects none. */
  featureFlags: TestSpecFeatureFlagVariant[] | null;
  /** How the test case's runs start across its resolutions. */
  runStrategy: RunStrategy;
  runSettingsList: ITestCaseRunSettingsRow[];
}
