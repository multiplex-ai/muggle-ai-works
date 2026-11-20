import type { RunEnvironment } from "../../e2e/contracts/run-environment.js";

/** A project lane's feature flags axis, named as muggle-remote-project-feature-flags-update takes it. */
export interface IProjectFeatureFlags {
  /** Every flag a test case on the lane may run with. */
  enabledValues: string[];
  /** Flags a test case that picks none of its own runs with. */
  defaultValues: string[];
  /** Named flag sets a test case can pick by name. */
  valueGroups: Record<string, string[]>;
}

/** Output of muggle-remote-project-feature-flags-get. */
export interface IProjectFeatureFlagsOutput {
  projectId: string;
  runEnvironmentType: RunEnvironment;
  featureFlags: IProjectFeatureFlags;
}
