import { describe, expect, it } from "vitest";

import {
  LLM_SOURCE_HEADER,
  LLM_SOURCE_OPTIONS,
  LLM_SOURCE_PROMPT,
  LLM_SOURCE_SCOPE_NOTE,
  LlmSource,
  type ILlmSourcePlan,
  type ILlmSourceStatus,
} from "../../../../packages/mcps/src/index.js";

import { askLlmSourceSelection } from "../../../cli/llm-source/llm-source-terminal-step.js";
import type { ILlmSourcePrompter } from "../../../cli/llm-source/llm-source-command-types.js";

function buildPlan(current: ILlmSourceStatus = { source: LlmSource.MuggleCredit }): ILlmSourcePlan {
  return {
    header: LLM_SOURCE_HEADER,
    prompt: LLM_SOURCE_PROMPT,
    scopeNote: LLM_SOURCE_SCOPE_NOTE,
    options: [...LLM_SOURCE_OPTIONS],
    current: current,
  };
}

/** Answers visible and hidden questions from separate queues, recording which kind each was. */
function scriptedPrompter(visibleAnswers: string[], hiddenAnswers: string[] = []) {
  const hiddenQuestions: string[] = [];
  const prompter: ILlmSourcePrompter = {
    ask: async () => visibleAnswers.shift() ?? "",
    askHidden: async (question) => {
      hiddenQuestions.push(question);
      return hiddenAnswers.shift() ?? "";
    },
  };
  return { prompter: prompter, hiddenQuestions: hiddenQuestions };
}

const silentPrint = (): void => undefined;

describe("askLlmSourceSelection", () => {
  it("keeps the current source on a bare Enter", async () => {
    const { prompter } = scriptedPrompter([""]);

    expect(await askLlmSourceSelection(prompter, buildPlan(), silentPrint)).toBeUndefined();
  });

  it("selects Muggle AI credit without further questions", async () => {
    const { prompter, hiddenQuestions } = scriptedPrompter(["1"]);

    expect(await askLlmSourceSelection(prompter, buildPlan(), silentPrint)).toEqual({
      source: LlmSource.MuggleCredit,
    });
    expect(hiddenQuestions).toHaveLength(0);
  });

  it("reads the Anthropic key only from the hidden prompt", async () => {
    const { prompter, hiddenQuestions } = scriptedPrompter(["2"], ["  sk-ant-user  "]);

    expect(await askLlmSourceSelection(prompter, buildPlan(), silentPrint)).toEqual({
      source: LlmSource.AnthropicApiKey,
      apiKey: "sk-ant-user",
    });
    expect(hiddenQuestions[0]).toContain("Anthropic API key");
  });

  it("cancels the Anthropic choice on an empty key", async () => {
    const { prompter } = scriptedPrompter(["2"], [""]);

    expect(await askLlmSourceSelection(prompter, buildPlan(), silentPrint)).toBeUndefined();
  });

  it("offers Ollama's endpoint for a first local setup and re-asks until a model is named", async () => {
    const { prompter } = scriptedPrompter(["3", "", "", "qwen2.5vl"], [""]);

    expect(await askLlmSourceSelection(prompter, buildPlan(), silentPrint)).toEqual({
      source: LlmSource.LocalModel,
      localBaseUrl: "http://localhost:11434/v1",
      localModel: "qwen2.5vl",
      apiKey: undefined,
    });
  });

  it("re-asks for an endpoint that is not an http(s) URL", async () => {
    const printed: string[] = [];
    const { prompter } = scriptedPrompter(["3", "localhost:1234", "http://localhost:1234/v1", "llava"]);

    const selection = await askLlmSourceSelection(prompter, buildPlan(), (line) => printed.push(line));

    expect(selection?.localBaseUrl).toBe("http://localhost:1234/v1");
    expect(printed.join("\n")).toContain("Enter an http(s) URL");
  });

  it("pre-fills the current local endpoint and model", async () => {
    const current: ILlmSourceStatus = {
      source: LlmSource.LocalModel,
      localBaseUrl: "http://gpu-box:8000/v1",
      localModel: "qwen2.5vl",
    };
    const { prompter } = scriptedPrompter(["3", "", ""], ["endpoint-key"]);

    expect(await askLlmSourceSelection(prompter, buildPlan(current), silentPrint)).toEqual({
      source: LlmSource.LocalModel,
      localBaseUrl: "http://gpu-box:8000/v1",
      localModel: "qwen2.5vl",
      apiKey: "endpoint-key",
    });
  });

  it("re-asks until the source number is in range", async () => {
    const { prompter } = scriptedPrompter(["9", "x", "1"]);

    expect(await askLlmSourceSelection(prompter, buildPlan(), silentPrint)).toEqual({
      source: LlmSource.MuggleCredit,
    });
  });

  it("marks the current source and says which runs it applies to", async () => {
    const printed: string[] = [];
    const { prompter } = scriptedPrompter([""]);

    await askLlmSourceSelection(
      prompter,
      buildPlan({ source: LlmSource.AnthropicApiKey, maskedApiKey: "…a1b2" }),
      (line) => printed.push(line),
    );

    const output = printed.join("\n");
    expect(output).toContain("* 2. My own Anthropic API key");
    expect(output).toContain("Cloud runs always use Muggle AI credit");
    expect(output).toContain("(…a1b2)");
  });
});
