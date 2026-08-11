/** Seconds each `watcherLifetime` preference value maps to. */

import { PreferenceValue } from "./preferences-types.js";

/** Unbounded lifetime. The guard library reads 0 as "never retire". */
export const WATCHER_LIFETIME_UNBOUNDED_SECONDS = 0;

/**
 * Lifetime in seconds per preference value.
 *
 * The watch loop is plain `sh` and cannot read preferences, so the resolved
 * value is converted here and exported into the loop's environment at arm time.
 *
 * Output shape: `{ "1d": 86400, "7d": 604800, "never": 0 }`
 */
export const WATCHER_LIFETIME_SECONDS: Readonly<Partial<Record<PreferenceValue, number>>> = {
  [PreferenceValue.OneDay]: 86400,
  [PreferenceValue.SevenDays]: 604800,
  [PreferenceValue.Never]: WATCHER_LIFETIME_UNBOUNDED_SECONDS,
};
