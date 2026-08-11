/**
 * Resolve the user's LLM environment overrides and apply them to a spawned process env.
 *
 * Users set an `llmEnv` block in `~/.muggle-ai/preferences.json`; muggle-works forwards it to
 * Studio at spawn time so a provider change takes effect on the next run, without restarting
 * the MCP host. Studio itself only reads environment variables.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { getDataDir } from "./data-dir.js";
import { FORWARDABLE_LLM_ENV_NAMES, LLM_ENV_PREFERENCE_KEY } from "./llm-env-constants.js";
import { PREFERENCES_FILE_NAME } from "./preferences-constants.js";

/**
 * Read the `llmEnv` block from the preferences file, keeping only forwardable names.
 * Values are stringified so numeric entries (maxTokens, temperature) survive JSON typing.
 * @param dataDirOverride - Override data dir for testing.
 * @returns Env overrides, e.g. `{ MUGGLE_LLM_PROVIDER: "local", MUGGLE_LLM_MODEL: "llava" }`.
 */
export function resolveLlmEnvOverrides(dataDirOverride?: string): Record<string, string> {
  const filePath = path.join(dataDirOverride ?? getDataDir(), PREFERENCES_FILE_NAME);
  let block: unknown;
  try {
    if (!fs.existsSync(filePath)) {
      return {};
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    block = raw[LLM_ENV_PREFERENCE_KEY];
  } catch {
    return {};
  }

  if (!block || typeof block !== "object" || Array.isArray(block)) {
    return {};
  }

  const overrides: Record<string, string> = {};
  for (const [name, value] of Object.entries(block as Record<string, unknown>)) {
    if (!FORWARDABLE_LLM_ENV_NAMES.includes(name)) {
      continue;
    }
    if (value === null || value === undefined || value === "") {
      continue;
    }
    overrides[name] = String(value);
  }
  return overrides;
}

/**
 * Apply the user's LLM env overrides to a process environment, without displacing values the
 * caller already exported — an explicit shell variable outranks the stored preference.
 * @param baseEnv - Environment to extend (typically a copy of `process.env`).
 * @param dataDirOverride - Override data dir for testing.
 * @returns The extended environment plus the names taken from preferences, for the caller to log.
 *
 * Output shape: `{ env: { MUGGLE_LLM_MODEL: "llava", ... }, appliedNames: ["MUGGLE_LLM_MODEL"] }`
 */
export function applyLlmEnvOverrides(
  baseEnv: NodeJS.ProcessEnv,
  dataDirOverride?: string,
): { env: NodeJS.ProcessEnv; appliedNames: string[] } {
  const overrides = resolveLlmEnvOverrides(dataDirOverride);
  const appliedNames: string[] = [];

  for (const [name, value] of Object.entries(overrides)) {
    if (baseEnv[name] !== undefined && baseEnv[name] !== "") {
      continue;
    }
    baseEnv[name] = value;
    appliedNames.push(name);
  }

  return { env: baseEnv, appliedNames: appliedNames };
}
