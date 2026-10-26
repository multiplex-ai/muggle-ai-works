import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LlmSource } from "../shared/llm-source/llm-source-types.js";
import {
  applyLlmSourceSelection,
  buildLlmSourcePlan,
  describeLlmSourceStatus,
  isValidLocalBaseUrl,
  maskLlmApiKey,
  resolveLlmSourceStatus,
} from "../shared/llm-source/llm-source-service.js";
import { readStoredLlmApiKey } from "../shared/llm-source/llm-credentials-store.js";

const USER_ANTHROPIC_KEY = "sk-ant-user-key-a1b2";

describe("llm source service", () => {
  let dataDir: string;

  function preferencesPath(): string {
    return path.join(dataDir, "preferences.json");
  }

  function credentialsPath(): string {
    return path.join(dataDir, "llm-credentials.json");
  }

  function readPreferencesFile(): Record<string, unknown> {
    return JSON.parse(fs.readFileSync(preferencesPath(), "utf-8")) as Record<string, unknown>;
  }

  function writePreferencesFile(content: unknown): void {
    fs.writeFileSync(preferencesPath(), JSON.stringify(content, null, 2), "utf-8");
  }

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-llm-source-"));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("resolves to Muggle AI credit when nothing is configured", () => {
    expect(resolveLlmSourceStatus(dataDir)).toEqual({ source: LlmSource.MuggleCredit });
  });

  it("stores an Anthropic key apart from the preferences file", () => {
    const status = applyLlmSourceSelection(
      { source: LlmSource.AnthropicApiKey, apiKey: `  ${USER_ANTHROPIC_KEY}  ` },
      dataDir,
    );

    expect(status).toEqual({ source: LlmSource.AnthropicApiKey, maskedApiKey: "…a1b2" });
    expect(readPreferencesFile().llmEnv).toEqual({ MUGGLE_LLM_PROVIDER: "anthropic" });
    expect(fs.readFileSync(preferencesPath(), "utf-8")).not.toContain(USER_ANTHROPIC_KEY);
    expect(readStoredLlmApiKey(dataDir)).toBe(USER_ANTHROPIC_KEY);
  });

  it.skipIf(process.platform === "win32")("keeps the credentials file owner-only", () => {
    fs.writeFileSync(credentialsPath(), "{}", { mode: 0o644 });

    applyLlmSourceSelection({ source: LlmSource.AnthropicApiKey, apiKey: USER_ANTHROPIC_KEY }, dataDir);

    expect(fs.statSync(credentialsPath()).mode & 0o777).toBe(0o600);
  });

  it("rejects the Anthropic source without a key", () => {
    expect(() => applyLlmSourceSelection({ source: LlmSource.AnthropicApiKey, apiKey: " " }, dataDir)).toThrow(
      /API key is required/,
    );
    expect(fs.existsSync(preferencesPath())).toBe(false);
  });

  it("reports Muggle AI credit when Anthropic is selected but no key exists", () => {
    writePreferencesFile({ version: 1, preferences: {}, llmEnv: { MUGGLE_LLM_PROVIDER: "anthropic" } });

    expect(resolveLlmSourceStatus(dataDir).source).toBe(LlmSource.MuggleCredit);
  });

  it("writes a local endpoint and keeps the user's own tuning entries", () => {
    writePreferencesFile({
      version: 1,
      preferences: { autoLogin: "always" },
      onboardingCompletedAt: "2026-10-01T00:00:00.000Z",
      llmEnv: {
        MUGGLE_LLM_PROVIDER: "local",
        MUGGLE_LLM_MODEL: "llava",
        MUGGLE_LLM_API_KEY: "legacy-inline-key",
        MUGGLE_LLM_MAX_TOKENS: "4096",
      },
    });

    const status = applyLlmSourceSelection(
      { source: LlmSource.LocalModel, localBaseUrl: "http://localhost:1234/v1", localModel: " qwen2.5vl " },
      dataDir,
    );

    const file = readPreferencesFile();
    expect(file.llmEnv).toEqual({
      MUGGLE_LLM_PROVIDER: "local",
      MUGGLE_LLM_BASE_URL: "http://localhost:1234/v1",
      MUGGLE_LLM_MODEL: "qwen2.5vl",
      MUGGLE_LLM_MAX_TOKENS: "4096",
    });
    expect(file.preferences).toEqual({ autoLogin: "always" });
    expect(file.onboardingCompletedAt).toBe("2026-10-01T00:00:00.000Z");
    expect(status).toEqual({
      source: LlmSource.LocalModel,
      maskedApiKey: undefined,
      localBaseUrl: "http://localhost:1234/v1",
      localModel: "qwen2.5vl",
    });
  });

  it("stores a local endpoint's key in the credentials file", () => {
    applyLlmSourceSelection(
      {
        source: LlmSource.LocalModel,
        localBaseUrl: "https://llm.internal.example/v1",
        localModel: "qwen2.5vl",
        apiKey: "vpc-endpoint-key",
      },
      dataDir,
    );

    expect(readStoredLlmApiKey(dataDir)).toBe("vpc-endpoint-key");
    expect(fs.readFileSync(preferencesPath(), "utf-8")).not.toContain("vpc-endpoint-key");
  });

  it("rejects a local endpoint that is not an http(s) URL or has no model", () => {
    expect(() =>
      applyLlmSourceSelection({ source: LlmSource.LocalModel, localBaseUrl: "localhost:11434", localModel: "llava" }, dataDir),
    ).toThrow(/http\(s\) endpoint/);
    expect(() =>
      applyLlmSourceSelection({ source: LlmSource.LocalModel, localBaseUrl: "http://localhost:11434/v1" }, dataDir),
    ).toThrow(/model name/);
  });

  it("switching back to Muggle AI credit removes the provider selection and the stored key", () => {
    applyLlmSourceSelection({ source: LlmSource.AnthropicApiKey, apiKey: USER_ANTHROPIC_KEY }, dataDir);

    const status = applyLlmSourceSelection({ source: LlmSource.MuggleCredit }, dataDir);

    expect(status).toEqual({ source: LlmSource.MuggleCredit });
    expect(readPreferencesFile()).not.toHaveProperty("llmEnv");
    expect(fs.existsSync(credentialsPath())).toBe(false);
  });

  it("builds a plan with the current source and every option", () => {
    const plan = buildLlmSourcePlan(dataDir);

    expect(plan.options.map((option) => option.source)).toEqual([
      LlmSource.MuggleCredit,
      LlmSource.AnthropicApiKey,
      LlmSource.LocalModel,
    ]);
    expect(plan.current.source).toBe(LlmSource.MuggleCredit);
    expect(plan.scopeNote).toContain("Cloud runs always use Muggle AI credit");
  });

  it("describes each status without revealing a key", () => {
    expect(describeLlmSourceStatus({ source: LlmSource.MuggleCredit })).toBe("LLM source: Muggle AI credit");
    expect(describeLlmSourceStatus({ source: LlmSource.AnthropicApiKey, maskedApiKey: "…a1b2" })).toBe(
      "LLM source: My own Anthropic API key (…a1b2)",
    );
    expect(
      describeLlmSourceStatus({
        source: LlmSource.LocalModel,
        localBaseUrl: "http://localhost:11434/v1",
        localModel: "qwen2.5vl",
      }),
    ).toBe("LLM source: A local or self-hosted model — qwen2.5vl at http://localhost:11434/v1");
  });

  it("masks short keys entirely", () => {
    expect(maskLlmApiKey("abcd")).toBe("…");
    expect(maskLlmApiKey(USER_ANTHROPIC_KEY)).toBe("…a1b2");
  });

  it("accepts only http(s) endpoint URLs", () => {
    expect(isValidLocalBaseUrl("http://localhost:11434/v1")).toBe(true);
    expect(isValidLocalBaseUrl("https://llm.internal.example/v1")).toBe(true);
    expect(isValidLocalBaseUrl("file:///etc/passwd")).toBe(false);
    expect(isValidLocalBaseUrl("not a url")).toBe(false);
  });
});
