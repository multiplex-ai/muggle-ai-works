/**
 * Type definitions for choosing who supplies the model behind local Studio runs.
 */

/** Who supplies the model for test runs Studio executes on this computer. */
export enum LlmSource {
  /** Muggle's designated models, metered against Muggle AI credit. */
  MuggleCredit = "muggle-credit",
  /** Muggle's designated models on the user's own Anthropic key; no credit is used. */
  AnthropicApiKey = "anthropic-api-key",
  /** The user's OpenAI-compatible endpoint; no credit is used. */
  LocalModel = "local-model",
}

/**
 * A source the user picked, with the settings it needs.
 */
export interface ILlmSourceSelection {
  /** The source picked. */
  source: LlmSource;
  /** The user's key — required for `AnthropicApiKey`, optional for `LocalModel`. */
  apiKey?: string;
  /** OpenAI-compatible endpoint URL — required for `LocalModel`. */
  localBaseUrl?: string;
  /** Vision-capable model id hosted at the endpoint — required for `LocalModel`. */
  localModel?: string;
}

/**
 * The source in effect, safe to display.
 *
 * Output shape: `{ source: "anthropic-api-key", maskedApiKey: "…a1b2" }`
 */
export interface ILlmSourceStatus {
  /** The source Studio will use on the next local run. */
  source: LlmSource;
  /** Last characters of the stored key, when one is stored. */
  maskedApiKey?: string;
  /** Configured endpoint, for `LocalModel`. */
  localBaseUrl?: string;
  /** Configured model, for `LocalModel`. */
  localModel?: string;
}

/**
 * One source as presented to the user.
 */
export interface ILlmSourceOption {
  /** Source applied when this option wins. */
  source: LlmSource;
  /** Text shown to the user. */
  label: string;
  /** Who pays and what setup it needs. */
  description: string;
}

/**
 * Everything a front-end needs to render the LLM-source question.
 *
 * Output shape: `{ header: "LLM source", prompt: "...", scopeNote: "...", options: [...], current: { source: "muggle-credit" } }`
 */
export interface ILlmSourcePlan {
  /** Short question name. */
  header: string;
  /** Question text. */
  prompt: string;
  /** Which runs the choice applies to. */
  scopeNote: string;
  /** Sources offered, in presentation order. */
  options: ILlmSourceOption[];
  /** The source currently in effect. */
  current: ILlmSourceStatus;
}

/**
 * Contents of the LLM credentials file.
 */
export interface IStoredLlmCredentials {
  /** The user's model API key. */
  apiKey: string;
}
