/** The showElectronBrowser preference decides a local run's browser visibility over the caller's showUi. */

import { describe, expect, it } from "vitest";

import { resolveElectronBrowserVisibility } from "../mcp/local/services/electron-browser-visibility.js";
import { formatElectronBrowserVisibilityLine } from "../mcp/tools/local/electron-browser-visibility-line.js";
import { PreferenceValue } from "../shared/preferences-types.js";

describe("resolveElectronBrowserVisibility", () => {
  it.each([
    [PreferenceValue.Always, true, true, false],
    [PreferenceValue.Always, false, true, true],
    [PreferenceValue.Always, undefined, true, false],
    [PreferenceValue.Never, true, false, true],
    [PreferenceValue.Never, false, false, false],
    [PreferenceValue.Never, undefined, false, false],
    [PreferenceValue.Ask, true, true, false],
    [PreferenceValue.Ask, false, false, false],
    [PreferenceValue.Ask, undefined, true, false],
  ])(
    "under %s with showUi %s shows the browser: %s (caller overridden: %s)",
    (showElectronBrowserPreference, requestedShowUi, isBrowserShown, isCallerOverridden) => {
      expect(
        resolveElectronBrowserVisibility({
          requestedShowUi: requestedShowUi,
          showElectronBrowserPreference: showElectronBrowserPreference,
        }),
      ).toEqual({
        isBrowserShown: isBrowserShown,
        isCallerOverridden: isCallerOverridden,
        showElectronBrowserPreference: showElectronBrowserPreference,
      });
    },
  );
});

describe("formatElectronBrowserVisibilityLine", () => {
  it("names only the visibility when the caller was not overridden", () => {
    expect(
      formatElectronBrowserVisibilityLine({
        isBrowserShown: false,
        isCallerOverridden: false,
        showElectronBrowserPreference: PreferenceValue.Ask,
      }),
    ).toBe("**UI:** headless");
  });

  it("names the preference and the ignored showUi when the preference overrode the caller", () => {
    expect(
      formatElectronBrowserVisibilityLine({
        isBrowserShown: true,
        isCallerOverridden: true,
        showElectronBrowserPreference: PreferenceValue.Always,
      }),
    ).toBe('**UI:** visible GUI — showElectronBrowser is "always", so showUi: false was ignored');
  });
});
