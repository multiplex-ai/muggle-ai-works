/**
 * Zod schemas for preferences tools.
 */

import { z } from "zod";

import { PreferenceKey, PreferenceValue } from "../../../shared/preferences-types.js";

const preferenceKeyValues = Object.values(PreferenceKey) as [string, ...string[]];
const preferenceValueValues = Object.values(PreferenceValue) as [string, ...string[]];

/**
 * Input schema for muggle-local-preferences-set.
 */
export const PreferencesSetInputSchema = z.object({
  key: z.enum(preferenceKeyValues).describe("The preference key to set."),
  value: z.enum(preferenceValueValues).describe("The value: always, ask, or never."),
  scope: z.enum(["global", "project"]).default("global").describe("Write to global (~/.muggle-ai/) or project (.muggle-ai/) preferences."),
  cwd: z.string().optional().describe("Project root directory. Required when scope is 'project'."),
});

export type PreferencesSetInput = z.infer<typeof PreferencesSetInputSchema>;
