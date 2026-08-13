/**
 * LLM environment overrides — the `llmEnv` block users set in
 * `~/.muggle-ai/preferences.json` to point Studio at a different LLM provider.
 *
 * The block is a sibling of `preferences`, not a member of it: preference values are a
 * closed enum (`always`/`ask`/`never`/...), these are free-text, and keeping them out of
 * `preferences` also keeps them out of the SessionStart one-liner that echoes preferences
 * into session context.
 */

/** Top-level key in the preferences file holding the env overrides. */
export const LLM_ENV_PREFERENCE_KEY = "llmEnv";

/**
 * Environment variables Studio reads to select its LLM provider. Only these names are
 * forwarded from the preferences file, so the file cannot inject arbitrary environment
 * (`PATH`, `NODE_OPTIONS`, ...) into the spawned Studio process.
 */
export const FORWARDABLE_LLM_ENV_NAMES: readonly string[] = [
  "MUGGLE_LLM_PROVIDER",
  "MUGGLE_LLM_BASE_URL",
  "MUGGLE_LLM_API_KEY",
  "MUGGLE_LLM_MODEL",
  "MUGGLE_LLM_MODEL_PREDICTION",
  "MUGGLE_LLM_MODEL_SUMMARIZER",
  "MUGGLE_LLM_MODEL_EVAL",
  "MUGGLE_LLM_MAX_TOKENS",
  "MUGGLE_LLM_TEMPERATURE",
  "MUGGLE_LLM_TOP_P",
  "MUGGLE_LLM_TIMEOUT_MS",
];
