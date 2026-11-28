import { describe, expect, it } from "vitest";
import { ModelSource } from "../domain/types";
import { assertModelSourceUsable, assertStudioRanOnSource, buildStudioEnv } from "./model-source";

describe("buildStudioEnv", () => {
  it("sets studio's source variable when the batch names a source", () => {
    expect(buildStudioEnv({ baseEnv: { PATH: "/bin" }, modelSource: ModelSource.ClaudeCode })).toEqual({
      PATH: "/bin",
      MUGGLE_LLM_PROVIDER: "claude-code",
    });
  });

  it("keeps the judge's Anthropic credentials away from a claude-code studio", () => {
    const studioEnv = buildStudioEnv({
      baseEnv: { PATH: "/bin", ANTHROPIC_API_KEY: "judge-key", ANTHROPIC_AUTH_TOKEN: "token" },
      modelSource: ModelSource.ClaudeCode,
    });

    expect(studioEnv).toEqual({ PATH: "/bin", MUGGLE_LLM_PROVIDER: "claude-code" });
  });

  it("passes Anthropic credentials through on the anthropic source", () => {
    const studioEnv = buildStudioEnv({
      baseEnv: { ANTHROPIC_API_KEY: "judge-key", MUGGLE_LLM_API_KEY: "own-key" },
      modelSource: ModelSource.Anthropic,
    });

    expect(studioEnv.ANTHROPIC_API_KEY).toBe("judge-key");
    expect(studioEnv.MUGGLE_LLM_API_KEY).toBe("own-key");
  });

  it("leaves the inherited environment as it is without a source", () => {
    expect(buildStudioEnv({ baseEnv: { PATH: "/bin", MUGGLE_LLM_PROVIDER: "local" } })).toEqual({
      PATH: "/bin",
      MUGGLE_LLM_PROVIDER: "local",
    });
  });
});

describe("assertModelSourceUsable", () => {
  it("refuses the API source without the operator's own key", () => {
    expect(() => assertModelSourceUsable({ env: {}, modelSource: ModelSource.Anthropic })).toThrow(
      /MUGGLE_LLM_API_KEY is unset/,
    );
  });

  it("accepts the API source with a key, and Claude Code or the default without one", () => {
    expect(() =>
      assertModelSourceUsable({ env: { MUGGLE_LLM_API_KEY: "sk-own" }, modelSource: ModelSource.Anthropic }),
    ).not.toThrow();
    expect(() => assertModelSourceUsable({ env: {}, modelSource: ModelSource.ClaudeCode })).not.toThrow();
    expect(() => assertModelSourceUsable({ env: {} })).not.toThrow();
  });
});

describe("assertStudioRanOnSource", () => {
  it("passes when studio confirms the configured source, or when none was configured", () => {
    expect(() =>
      assertStudioRanOnSource({ taskId: "t", configuredSource: ModelSource.ClaudeCode, reportedSource: "claude-code" }),
    ).not.toThrow();
    expect(() => assertStudioRanOnSource({ taskId: "t", reportedSource: "anthropic" })).not.toThrow();
  });

  it("fails when studio ran on another source or did not report one", () => {
    expect(() =>
      assertStudioRanOnSource({ taskId: "t", configuredSource: ModelSource.ClaudeCode, reportedSource: "anthropic" }),
    ).toThrow(/on model source anthropic but the batch configured claude-code/);
    expect(() => assertStudioRanOnSource({ taskId: "t", configuredSource: ModelSource.ClaudeCode })).toThrow(
      /\(not reported\)/,
    );
  });
});
