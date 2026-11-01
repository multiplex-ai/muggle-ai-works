import { RunStrategy } from "../../e2e/contracts/run-strategy-types.js";
import { DisplayResolution } from "../../local/types/enums.js";

/** Every resolution this MCP version knows; a backend value outside it is left out of tool output. */
export const KNOWN_DISPLAY_RESOLUTIONS: ReadonlySet<string> = new Set<string>(Object.values(DisplayResolution));

/** Every run strategy this MCP version knows. */
export const KNOWN_RUN_STRATEGIES: ReadonlySet<string> = new Set<string>(Object.values(RunStrategy));

/** The run strategy a project lane with no saved one runs under; mirrors the backend's `DEFAULT_FAN_OUT_POLICY`. */
export const DEFAULT_RUN_STRATEGY = RunStrategy.PrimaryOnly;
