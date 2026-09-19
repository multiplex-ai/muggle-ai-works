/**
 * Pixel dimensions for each {@link DisplayResolution}, and the resolution a run
 * falls back to. Kept separate so {@link ./display-resolution.ts} stays
 * logic-only.
 */

import { DisplayResolution } from "../types/enums.js";
import type { DisplayParams } from "../types/display-types.js";

/** Webview dimensions each resolution maps to. */
export const DISPLAY_PARAMS_BY_RESOLUTION: Record<DisplayResolution, DisplayParams> = {
  [DisplayResolution.R_0800x0600]: { browserWindowWidth: 800, browserWindowHeight: 600 },
  [DisplayResolution.R_1024x0768]: { browserWindowWidth: 1024, browserWindowHeight: 768 },
  [DisplayResolution.R_0390x0844]: { browserWindowWidth: 390, browserWindowHeight: 844 },
  [DisplayResolution.R_1920x1080]: { browserWindowWidth: 1920, browserWindowHeight: 1080 },
};

/**
 * Resolution used when a run names none. Matches the electron-app's own
 * hardcoded fallback (`WEBVIEW_WIDTH` / `WEBVIEW_HEIGHT`), so emitting it
 * changes nothing for callers that never ask for a resolution.
 */
export const DEFAULT_DISPLAY_RESOLUTION = DisplayResolution.R_1920x1080;
