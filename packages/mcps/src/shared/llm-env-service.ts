/**
 * Resolve the user's LLM environment overrides and apply them to a spawned process env.
 *
 * Users set an `llmEnv` block in `~/.muggle-ai/preferences.json`; muggle-works forwards it to
 * Studio at spawn time so a provider change takes effect on the next run, without restarting
 * the MCP host. Studio itself only reads environment variables.
 */

import { FORWARDABLE_LLM_ENV_NAMES } from "./llm-env-constants.js";
import { LlmEnvName } from "./llm-env-types.js";
import { readStoredLlmApiKey } from "./llm-source/llm-credentials-store.js";
import { readPreferencesMetadata } from "./preferences-service.js";

/**
 * Read the `llmEnv` block from the preferences file, keeping only forwardable names.
 * Values are stringified so numeric entries (maxTokens, temperature) survive JSON typing.
 * When a provider is selected and the block carries no key, the key stored in the LLM
 * credentials file is supplied — the key lives apart from the preferences file on purpose.
 * @param dataDirOverride - Override data dir for testing.
 * @returns Env overrides, e.g. `{ MUGGLE_LLM_PROVIDER: "local", MUGGLE_LLM_MODEL: "llava" }`.
 */
export function resolveLlmEnvOverrides(dataDirOverride?: string): Record<string, string> {
  const block: unknown = readPreferencesMetadata(dataDirOverride).llmEnv;

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

  if (overrides[LlmEnvName.Provider] && !overrides[LlmEnvName.ApiKey]) {
    const storedApiKey = readStoredLlmApiKey(dataDirOverride);
    if (storedApiKey) {
      overrides[LlmEnvName.ApiKey] = storedApiKey;
    }
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
