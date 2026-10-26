import { resolvePreferences } from "../../../shared/preferences-service.js";
import { PreferenceKey, PreferenceValue } from "../../../shared/preferences-types.js";
import type { IElectronBrowserVisibility } from "./electron-browser-visibility-types.js";

/**
 * Decide whether a local run shows the Studio browser. The user's `showElectronBrowser` preference
 * decides when it is `always` or `never`, whatever the caller asked; under any other value the caller's
 * `showUi` counts, and an omitted `showUi` shows the browser.
 *
 * @param params.requestedShowUi - The caller's `showUi`, or undefined when omitted.
 * @param params.showElectronBrowserPreference - The `showElectronBrowser` preference value in effect.
 * @returns Whether the browser is shown, and whether the preference overrode the caller.
 *
 * Output shape: `{ isBrowserShown: true, isCallerOverridden: true, showElectronBrowserPreference: "always" }`
 * for `showUi: false` under `always`.
 */
export function resolveElectronBrowserVisibility(params: {
  requestedShowUi: boolean | undefined;
  showElectronBrowserPreference: PreferenceValue;
}): IElectronBrowserVisibility {
  const isBrowserShown = decideIsBrowserShown(params);
  return {
    isBrowserShown: isBrowserShown,
    isCallerOverridden: params.requestedShowUi !== undefined && params.requestedShowUi !== isBrowserShown,
    showElectronBrowserPreference: params.showElectronBrowserPreference,
  };
}

/**
 * Resolve a local run's browser visibility against the user's saved `showElectronBrowser` preference.
 *
 * @param params.requestedShowUi - The caller's `showUi`, or undefined when omitted.
 * @returns Whether the browser is shown, and whether the preference overrode the caller.
 */
export function resolveElectronBrowserVisibilityFromPreferences(params: {
  requestedShowUi: boolean | undefined;
}): IElectronBrowserVisibility {
  return resolveElectronBrowserVisibility({
    requestedShowUi: params.requestedShowUi,
    showElectronBrowserPreference: resolvePreferences()[PreferenceKey.ShowElectronBrowser],
  });
}

function decideIsBrowserShown(params: {
  requestedShowUi: boolean | undefined;
  showElectronBrowserPreference: PreferenceValue;
}): boolean {
  if (params.showElectronBrowserPreference === PreferenceValue.Always) {
    return true;
  }
  if (params.showElectronBrowserPreference === PreferenceValue.Never) {
    return false;
  }
  return params.requestedShowUi !== false;
}
