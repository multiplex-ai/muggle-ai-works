import type { RunEnvironment } from "../../e2e/contracts/run-environment.js";
import type { DisplayResolution } from "../../local/types/enums.js";

/** One axis of a project test spec as `GET /projects/:projectId/project-test-spec` returns it. */
export interface IRawProjectTestSpecAxis {
  enabledValues?: string[];
  default?: string[];
}

/** Body of `GET /projects/:projectId/project-test-spec`; `projectTestSpec` is null for a lane never edited. */
export interface IRawProjectTestSpecEnvelope {
  projectTestSpec?: {
    perAxis?: {
      displayResolution?: IRawProjectTestSpecAxis;
    };
  } | null;
}

/** Output of muggle-remote-project-display-resolutions-get. */
export interface IProjectDisplayResolutionsOutput {
  projectId: string;
  runEnvironmentType: RunEnvironment;
  /** Resolutions a test case that picks none of its own is verified at, first one primary. */
  displayResolutions: DisplayResolution[];
  /** Resolutions a test case on this lane may pick. */
  enabledResolutions: DisplayResolution[];
  /** True when the lane was never edited and runs at the platform default. */
  isPlatformDefault: boolean;
}
