/** Rebase budget each `maxCatchUpRebases` preference value maps to. */

import { PreferenceValue } from "./preferences-types.js";

/** Unbounded budget. The tick reads 0 as "never stop rebasing". */
export const CATCH_UP_REBASES_UNBOUNDED = 0;

/**
 * Catch-up rebases allowed per pull request, per preference value.
 *
 * Counted over a PR's whole life rather than per `rebase_key`, because that key
 * carries the base tip and so mints a fresh budget every time the base advances.
 *
 * Output shape: `{ "10": 10, "20": 20, "50": 50, "never": 0 }`
 */
export const CATCH_UP_REBASE_BUDGET: Readonly<Partial<Record<PreferenceValue, number>>> = {
  [PreferenceValue.TenRebases]: 10,
  [PreferenceValue.TwentyRebases]: 20,
  [PreferenceValue.FiftyRebases]: 50,
  [PreferenceValue.Never]: CATCH_UP_REBASES_UNBOUNDED,
};
