/**
 * LLM source service — resolve and change who supplies the model behind local Studio runs.
 *
 * The choice is stored as the `llmEnv` block the Studio spawn forwards, plus the user's key in
 * its own credentials file. Muggle AI credit is the absence of both.
 */

import { LlmEnvName, LlmProviderValue } from "../llm-env-types.js";
import { readPreferencesMetadata, writeLlmEnvBlock } from "../preferences-service.js";
import { checkClaudeCodeReadiness } from "./claude-code-readiness.js";
import { deleteStoredLlmApiKey, readStoredLlmApiKey, writeStoredLlmApiKey } from "./llm-credentials-store.js";
import {
  LLM_SOURCE_HEADER,
  LLM_SOURCE_OPTIONS,
  LLM_SOURCE_OWNED_ENV_NAMES,
  LLM_SOURCE_PROMPT,
  LLM_SOURCE_SCOPE_NOTE,
  MASKED_API_KEY_PREFIX,
  MASKED_API_KEY_VISIBLE_CHARS,
} from "./llm-source-constants.js";
import {
  ClaudeCodeReadiness,
  LlmSource,
  type ILlmSourceOption,
  type ILlmSourcePlan,
  type ILlmSourceSelection,
  type ILlmSourceStatus,
} from "./llm-source-types.js";

function readLlmEnvBlock(dataDirOverride?: string): Record<string, string> {
  const llmEnv = readPreferencesMetadata(dataDirOverride).llmEnv;
  if (!llmEnv || typeof llmEnv !== "object" || Array.isArray(llmEnv)) {
    return {};
  }
  return llmEnv;
}

/**
 * Mask a key down to its last few characters.
 * @param apiKey - The key to mask.
 * @returns E.g. `…a1b2`.
 */
export function maskLlmApiKey(apiKey: string): string {
  if (apiKey.length <= MASKED_API_KEY_VISIBLE_CHARS) {
    return MASKED_API_KEY_PREFIX;
  }
  return `${MASKED_API_KEY_PREFIX}${apiKey.slice(-MASKED_API_KEY_VISIBLE_CHARS)}`;
}

/**
 * Whether a URL can serve as an OpenAI-compatible endpoint.
 * @param candidateBaseUrl - The URL the user entered.
 */
export function isValidLocalBaseUrl(candidateBaseUrl: string): boolean {
  try {
    const parsed = new URL(candidateBaseUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Resolve the source Studio will use on the next local run.
 *
 * Anthropic selected without any key resolves to Muggle AI credit, because that is what
 * Studio falls back to — the status reports what will be billed, not what was intended.
 *
 * @param dataDirOverride - Override data dir for testing.
 */
export function resolveLlmSourceStatus(dataDirOverride?: string): ILlmSourceStatus {
  const llmEnv = readLlmEnvBlock(dataDirOverride);
  const apiKey = llmEnv[LlmEnvName.ApiKey] ?? readStoredLlmApiKey(dataDirOverride);
  const maskedApiKey = apiKey ? maskLlmApiKey(apiKey) : undefined;

  if (llmEnv[LlmEnvName.Provider] === LlmProviderValue.Anthropic && maskedApiKey) {
    return { source: LlmSource.AnthropicApiKey, maskedApiKey: maskedApiKey };
  }

  if (llmEnv[LlmEnvName.Provider] === LlmProviderValue.ClaudeCode) {
    return { source: LlmSource.ClaudeCode };
  }

  if (llmEnv[LlmEnvName.Provider] === LlmProviderValue.Local) {
    return {
      source: LlmSource.LocalModel,
      maskedApiKey: maskedApiKey,
      localBaseUrl: llmEnv[LlmEnvName.BaseUrl],
      localModel: llmEnv[LlmEnvName.Model],
    };
  }

  return { source: LlmSource.MuggleCredit };
}

/**
 * Find a source's presentation entry.
 * @param source - The source to look up.
 */
export function getLlmSourceOption(source: LlmSource): ILlmSourceOption {
  return LLM_SOURCE_OPTIONS.find((option) => option.source === source) ?? LLM_SOURCE_OPTIONS[0];
}

/**
 * Build the LLM-source question for a front-end to render.
 * @param dataDirOverride - Override data dir for testing.
 */
export function buildLlmSourcePlan(dataDirOverride?: string): ILlmSourcePlan {
  return {
    header: LLM_SOURCE_HEADER,
    prompt: LLM_SOURCE_PROMPT,
    scopeNote: LLM_SOURCE_SCOPE_NOTE,
    options: [...LLM_SOURCE_OPTIONS],
    current: resolveLlmSourceStatus(dataDirOverride),
  };
}

/**
 * Describe a status in one line, key masked.
 * @param status - The status to describe.
 * @returns E.g. `LLM source: A local or self-hosted model — qwen3.6 at http://localhost:11434/v1`.
 */
export function describeLlmSourceStatus(status: ILlmSourceStatus): string {
  const label = getLlmSourceOption(status.source).label;
  if (status.source === LlmSource.AnthropicApiKey) {
    return `LLM source: ${label} (${status.maskedApiKey})`;
  }
  if (status.source === LlmSource.LocalModel) {
    return `LLM source: ${label} — ${status.localModel} at ${status.localBaseUrl}`;
  }
  return `LLM source: ${label}`;
}

function assertClaudeCodeReady(): void {
  const readinessReport = checkClaudeCodeReadiness();
  if (readinessReport.readiness === ClaudeCodeReadiness.NotInstalled) {
    throw new Error(
      "Claude Code is not installed: no working `claude` executable is on the PATH. Install Claude Code from Anthropic, sign in by running `claude`, then choose this source again.",
    );
  }
  if (readinessReport.readiness === ClaudeCodeReadiness.SignedOut) {
    throw new Error(
      `Claude Code ${readinessReport.installedVersion} is not signed in. Sign in by running \`claude\` and following its sign-in, then choose this source again.`,
    );
  }
}

function assertValidSelection(selection: ILlmSourceSelection): void {
  if (selection.source === LlmSource.AnthropicApiKey && !selection.apiKey?.trim()) {
    throw new Error("An Anthropic API key is required for this source.");
  }
  if (selection.source === LlmSource.LocalModel) {
    if (!selection.localBaseUrl || !isValidLocalBaseUrl(selection.localBaseUrl)) {
      throw new Error("A local model needs an http(s) endpoint URL, e.g. http://localhost:11434/v1.");
    }
    if (!selection.localModel?.trim()) {
      throw new Error("A local model needs the model name the endpoint serves.");
    }
  }
  if (selection.source === LlmSource.ClaudeCode) {
    assertClaudeCodeReady();
  }
}

/**
 * Apply a source: write the provider selection Studio's spawn forwards and store or delete the key.
 *
 * A local selection keeps the user's own tuning entries in `llmEnv` (token limits, per-task models);
 * every other source replaces the block, since that tuning applies to local endpoints only.
 *
 * @param selection - What the user picked.
 * @param dataDirOverride - Override data dir for testing.
 * @returns The status now in effect.
 * @throws When the selection lacks a setting its source requires, or Claude Code is not installed or signed in.
 */
export function applyLlmSourceSelection(
  selection: ILlmSourceSelection,
  dataDirOverride?: string,
): ILlmSourceStatus {
  assertValidSelection(selection);

  if (selection.source === LlmSource.MuggleCredit) {
    writeLlmEnvBlock(undefined, dataDirOverride);
    deleteStoredLlmApiKey(dataDirOverride);
    return resolveLlmSourceStatus(dataDirOverride);
  }

  if (selection.source === LlmSource.AnthropicApiKey) {
    writeStoredLlmApiKey((selection.apiKey as string).trim(), dataDirOverride);
    writeLlmEnvBlock({ [LlmEnvName.Provider]: LlmProviderValue.Anthropic }, dataDirOverride);
    return resolveLlmSourceStatus(dataDirOverride);
  }

  if (selection.source === LlmSource.ClaudeCode) {
    writeLlmEnvBlock({ [LlmEnvName.Provider]: LlmProviderValue.ClaudeCode }, dataDirOverride);
    deleteStoredLlmApiKey(dataDirOverride);
    return resolveLlmSourceStatus(dataDirOverride);
  }

  const userTuning = Object.fromEntries(
    Object.entries(readLlmEnvBlock(dataDirOverride)).filter(([name]) => !LLM_SOURCE_OWNED_ENV_NAMES.includes(name)),
  );
  const localApiKey = selection.apiKey?.trim();
  if (localApiKey) {
    writeStoredLlmApiKey(localApiKey, dataDirOverride);
  } else {
    deleteStoredLlmApiKey(dataDirOverride);
  }
  writeLlmEnvBlock(
    {
      ...userTuning,
      [LlmEnvName.Provider]: LlmProviderValue.Local,
      [LlmEnvName.BaseUrl]: selection.localBaseUrl as string,
      [LlmEnvName.Model]: (selection.localModel as string).trim(),
    },
    dataDirOverride,
  );
  return resolveLlmSourceStatus(dataDirOverride);
}
