/**
 * Constants for choosing who supplies the model behind local Studio runs.
 */

import { LlmEnvName } from "../llm-env-types.js";
import { LlmSource, type ILlmSourceOption } from "./llm-source-types.js";

/** `llmEnv` names the LLM-source choice writes; any other entry is the user's own tuning. */
export const LLM_SOURCE_OWNED_ENV_NAMES: readonly string[] = [
  LlmEnvName.Provider,
  LlmEnvName.BaseUrl,
  LlmEnvName.ApiKey,
  LlmEnvName.Model,
];

/**
 * File in the Muggle data directory holding the user's model API key. Kept apart from
 * `preferences.json`, which agents read routinely and the session-start context summarizes.
 */
export const LLM_CREDENTIALS_FILE_NAME = "llm-credentials.json";

/** Short name of the LLM-source question. */
export const LLM_SOURCE_HEADER = "LLM source";

/** Question text for the LLM-source choice. */
export const LLM_SOURCE_PROMPT = "Who should supply the model for tests Studio runs on this computer?";

/** Which runs the choice applies to. */
export const LLM_SOURCE_SCOPE_NOTE = "Applies to runs on this computer. Cloud runs always use Muggle AI credit.";

/** Sources offered, in presentation order. The first is the default for a new user. */
export const LLM_SOURCE_OPTIONS: readonly ILlmSourceOption[] = [
  {
    source: LlmSource.MuggleCredit,
    label: "Muggle AI credit",
    description: "Muggle's designated models, billed to your Muggle AI credit. No setup.",
  },
  {
    source: LlmSource.AnthropicApiKey,
    label: "My own Anthropic API key",
    description: "Muggle's designated models on your key. Anthropic bills you; no Muggle AI credit is used.",
  },
  {
    source: LlmSource.LocalModel,
    label: "A local or self-hosted model",
    description:
      "Any OpenAI-compatible endpoint serving a vision model (Ollama, LM Studio, vLLM). No Muggle AI credit is used.",
  },
];

/** Endpoint offered when a local model is configured for the first time — Ollama's default. */
export const DEFAULT_LOCAL_LLM_BASE_URL = "http://localhost:11434/v1";

/** How many trailing characters of a stored key are shown. */
export const MASKED_API_KEY_VISIBLE_CHARS = 4;

/** Prefix shown in place of the hidden part of a key. */
export const MASKED_API_KEY_PREFIX = "…";
