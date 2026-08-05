/**
 * Zod schemas for preferences tools.
 */

import { z } from "zod";

import { PreferenceKey, PreferenceValue } from "../../../shared/preferences-types.js";
import { PREFERENCE_ALLOWED_VALUES } from "../../../shared/preferences-constants.js";

const preferenceKeyValues = Object.values(PreferenceKey) as [string, ...string[]];
const preferenceValueValues = Object.values(PreferenceValue) as [string, ...string[]];

/**
 * Input schema for muggle-local-preferences-set.
 *
 * Two-stage validation: enums verify key/value are individually valid,
 * then `.refine()` checks the value is allowed for that specific key
 * (e.g. `defaultExecutionMode` accepts `local`/`remote`/`ask`, not `always`/`never`).
 */
export const PreferencesSetInputSchema = z
  .object(
    {
      key: z.enum(preferenceKeyValues).describe("The preference key to set."),
      value: z
        .enum(preferenceValueValues)
        .describe("The value. Most keys accept always/ask/never; defaultExecutionMode accepts local/remote/ask."),
    },
    {
      error:
        "Expected only { key, value }: per-project preferences were removed, so scope and cwd are no longer accepted.",
    },
  )
  // Strict where sibling schemas strip. A caller predating the removal of
  // per-project preferences still sends `scope: "project"`; stripping it would
  // write that preference to every project instead of the one named. The
  // message names the removed keys, since the default text reports only that
  // some key was unrecognized.
  .strict()
  .superRefine((data, ctx) => {
    const allowed = PREFERENCE_ALLOWED_VALUES[data.key as PreferenceKey] as readonly string[];
    if (!allowed.includes(data.value)) {
      ctx.addIssue({
        code: "custom",
        message: `Value "${data.value}" is not allowed for preference "${data.key}". Allowed: ${allowed.join(", ")}`,
        path: ["value"],
      });
    }
  });

export type PreferencesSetInput = z.infer<typeof PreferencesSetInputSchema>;
