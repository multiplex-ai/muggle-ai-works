import type { RunEnvironment } from "../../e2e/contracts/run-environment.js";
import type { RunStrategy } from "../../e2e/contracts/run-strategy-types.js";
import type { DisplayResolution } from "../../local/types/enums.js";

/** One axis of a project test spec as `GET /projects/:projectId/project-test-spec` returns it. */
export interface IRawProjectTestSpecAxis {
  enabledValues?: string[];
  default?: string[];
}

/** Per-axis values of a project test spec lane, keyed by axis. */
export interface IRawProjectTestSpecPerAxis {
  displayResolution?: IRawProjectTestSpecAxis;
}

/**
 * Body of `GET /projects/:projectId/project-test-spec`. `effectivePerAxis` is the lane's per-axis values
 * in effect, resolved by the backend including the platform seed for a never-edited lane; an older
 * backend omits it. `projectTestSpec` is null for a lane never edited; `fanOutPolicy` is the lane's
 * effective policy, its saved one or else the backend default.
 */
export interface IRawProjectTestSpecEnvelope {
  effectivePerAxis?: IRawProjectTestSpecPerAxis;
  projectTestSpec?: {
    perAxis?: IRawProjectTestSpecPerAxis;
    fanOutPolicy?: string;
  } | null;
  fanOutPolicy?: string;
}

/** Resolution fields of a project create or update body: `displayOptions` primary first, and `fanOutPolicy`. */
export interface IProjectResolutionUpstreamFields {
  displayOptions?: DisplayResolution[];
  fanOutPolicy?: RunStrategy;
}

/** Output of muggle-remote-project-display-resolutions-get. */
export interface IProjectDisplayResolutionsOutput {
  projectId: string;
  runEnvironmentType: RunEnvironment;
  /** Resolution a test case that picks none of its own runs at first; null when this MCP version does not know it. */
  primaryResolution: DisplayResolution | null;
  /** Further resolutions such a test case also runs at, one run each, as `runStrategy` says. */
  compatibleResolutions: DisplayResolution[];
  /** Resolutions a test case on this lane may pick. */
  enabledResolutions: DisplayResolution[];
  /** How the lane's runs start across the primary and compatible resolutions. */
  runStrategy: RunStrategy;
}
