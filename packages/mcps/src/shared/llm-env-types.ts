/**
 * Type definitions for the Studio LLM environment contract.
 */

/**
 * Environment variables muggle-works writes and forwards to select Studio's LLM provider.
 * Studio reads the same names; the two must stay in step.
 */
export enum LlmEnvName {
  Provider = "MUGGLE_LLM_PROVIDER",
  BaseUrl = "MUGGLE_LLM_BASE_URL",
  ApiKey = "MUGGLE_LLM_API_KEY",
  Model = "MUGGLE_LLM_MODEL",
}

/** Values of `MUGGLE_LLM_PROVIDER` that muggle-works writes; Studio's provider enum carries the same strings. */
export enum LlmProviderValue {
  Anthropic = "anthropic",
  Local = "local",
}
