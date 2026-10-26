import type { IElectronBrowserVisibility } from "../../local/services/electron-browser-visibility-types.js";
import {
  ELECTRON_BROWSER_HIDDEN_LABEL,
  ELECTRON_BROWSER_SHOWN_LABEL,
} from "./electron-browser-visibility-line-constants.js";

/**
 * Format a run's `**UI:**` report line, naming the preference when it overrode the caller's `showUi`
 * so the calling agent stops passing a value the user's settings reject.
 *
 * @param visibility - The run's resolved browser visibility.
 * @returns The report line.
 *
 * Output shape: `**UI:** visible GUI — showElectronBrowser is "always", so showUi: false was ignored`
 */
export function formatElectronBrowserVisibilityLine(visibility: IElectronBrowserVisibility): string {
  const label = visibility.isBrowserShown ? ELECTRON_BROWSER_SHOWN_LABEL : ELECTRON_BROWSER_HIDDEN_LABEL;
  if (!visibility.isCallerOverridden) {
    return `**UI:** ${label}`;
  }
  const ignoredShowUi = !visibility.isBrowserShown;
  return `**UI:** ${label} — showElectronBrowser is "${visibility.showElectronBrowserPreference}", so showUi: ${ignoredShowUi} was ignored`;
}
