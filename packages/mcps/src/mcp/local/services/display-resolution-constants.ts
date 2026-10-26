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
  [DisplayResolution.R_0360x0800]: { browserWindowWidth: 360, browserWindowHeight: 800 },
  [DisplayResolution.R_0393x0852]: { browserWindowWidth: 393, browserWindowHeight: 852 },
  [DisplayResolution.R_0430x0932]: { browserWindowWidth: 430, browserWindowHeight: 932 },
  [DisplayResolution.R_0768x1024]: { browserWindowWidth: 768, browserWindowHeight: 1024 },
  [DisplayResolution.R_0820x1180]: { browserWindowWidth: 820, browserWindowHeight: 1180 },
  [DisplayResolution.R_1024x1366]: { browserWindowWidth: 1024, browserWindowHeight: 1366 },
  [DisplayResolution.R_1440x0900]: { browserWindowWidth: 1440, browserWindowHeight: 900 },
  [DisplayResolution.R_1512x0982]: { browserWindowWidth: 1512, browserWindowHeight: 982 },
  [DisplayResolution.R_1728x1117]: { browserWindowWidth: 1728, browserWindowHeight: 1117 },
  [DisplayResolution.R_1366x0768]: { browserWindowWidth: 1366, browserWindowHeight: 768 },
  [DisplayResolution.R_1536x0864]: { browserWindowWidth: 1536, browserWindowHeight: 864 },
  [DisplayResolution.R_2560x1440]: { browserWindowWidth: 2560, browserWindowHeight: 1440 },
};

/**
 * Resolution used when a run names none. Matches the electron-app's own
 * hardcoded fallback (`WEBVIEW_WIDTH` / `WEBVIEW_HEIGHT`), so emitting it
 * changes nothing for callers that never ask for a resolution.
 */
export const DEFAULT_DISPLAY_RESOLUTION = DisplayResolution.R_1920x1080;
