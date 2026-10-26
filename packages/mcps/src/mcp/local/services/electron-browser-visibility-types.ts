import type { PreferenceValue } from "../../../shared/preferences-types.js";

/**
 * Whether a local run shows the Studio browser, and what decided it.
 */
export interface IElectronBrowserVisibility {
  /** True when the Studio browser window is shown during the run. */
  isBrowserShown: boolean;
  /** True when the caller passed a `showUi` the `showElectronBrowser` preference overrode. */
  isCallerOverridden: boolean;
  /** The `showElectronBrowser` preference value in effect for the run. */
  showElectronBrowserPreference: PreferenceValue;
}
