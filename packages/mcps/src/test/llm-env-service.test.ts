import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyLlmEnvOverrides, resolveLlmEnvOverrides } from "../shared/llm-env-service.js";
import { writePreferences } from "../shared/preferences-service.js";

describe("llm env overrides", () => {
  let dataDir: string;

  function writePreferencesFileContent(content: unknown): void {
    fs.writeFileSync(path.join(dataDir, "preferences.json"), JSON.stringify(content, null, 2), "utf-8");
  }

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "muggle-llm-env-"));
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("returns an empty map when the preferences file is missing", () => {
    expect(resolveLlmEnvOverrides(path.join(dataDir, "absent"))).toEqual({});
  });

  it("returns an empty map when no llmEnv block is present", () => {
    writePreferencesFileContent({ version: 1, preferences: { autoLogin: "always" } });
    expect(resolveLlmEnvOverrides(dataDir)).toEqual({});
  });

  it("reads forwardable names and stringifies numeric values", () => {
    writePreferencesFileContent({
      version: 1,
      preferences: {},
      llmEnv: {
        MUGGLE_LLM_PROVIDER: "local",
        MUGGLE_LLM_BASE_URL: "http://localhost:11434/v1",
        MUGGLE_LLM_MODEL: "llava",
        MUGGLE_LLM_MAX_TOKENS: 4096,
      },
    });

    expect(resolveLlmEnvOverrides(dataDir)).toEqual({
      MUGGLE_LLM_PROVIDER: "local",
      MUGGLE_LLM_BASE_URL: "http://localhost:11434/v1",
      MUGGLE_LLM_MODEL: "llava",
      MUGGLE_LLM_MAX_TOKENS: "4096",
    });
  });

  it("drops names outside the forwardable allowlist", () => {
    writePreferencesFileContent({
      version: 1,
      preferences: {},
      llmEnv: { PATH: "/evil", NODE_OPTIONS: "--inspect", MUGGLE_LLM_MODEL: "llava" },
    });

    expect(resolveLlmEnvOverrides(dataDir)).toEqual({ MUGGLE_LLM_MODEL: "llava" });
  });

  it("skips empty values and tolerates a malformed block", () => {
    writePreferencesFileContent({ version: 1, preferences: {}, llmEnv: { MUGGLE_LLM_MODEL: "" } });
    expect(resolveLlmEnvOverrides(dataDir)).toEqual({});

    writePreferencesFileContent({ version: 1, preferences: {}, llmEnv: "not-an-object" });
    expect(resolveLlmEnvOverrides(dataDir)).toEqual({});
  });

  it("fills missing variables but never displaces an exported one", () => {
    writePreferencesFileContent({
      version: 1,
      preferences: {},
      llmEnv: { MUGGLE_LLM_MODEL: "llava", MUGGLE_LLM_BASE_URL: "http://localhost:11434/v1" },
    });

    const applied = applyLlmEnvOverrides({ MUGGLE_LLM_MODEL: "qwen2-vl" }, dataDir);

    expect(applied.env.MUGGLE_LLM_MODEL).toBe("qwen2-vl");
    expect(applied.env.MUGGLE_LLM_BASE_URL).toBe("http://localhost:11434/v1");
    expect(applied.appliedNames).toEqual(["MUGGLE_LLM_BASE_URL"]);
  });

  it("survives a preference write", () => {
    writePreferencesFileContent({
      version: 1,
      preferences: { autoLogin: "always" },
      llmEnv: { MUGGLE_LLM_MODEL: "llava" },
    });

    writePreferences({ autoWatchPR: "always" } as never, dataDir);

    expect(resolveLlmEnvOverrides(dataDir)).toEqual({ MUGGLE_LLM_MODEL: "llava" });
  });
});
