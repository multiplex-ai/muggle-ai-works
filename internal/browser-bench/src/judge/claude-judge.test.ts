import { describe, expect, it, vi } from "vitest";

import { buildJudgeContentBlocks, createClaudeJudgeInvoker } from "./claude-judge";

const readAsBase64 = (screenshotPath: string): string => `bytes-of-${screenshotPath}`;

describe("buildJudgeContentBlocks", () => {
  it("puts the prompt first so the judge reads the task before the evidence", () => {
    const blocks = buildJudgeContentBlocks({
      prompt: "Did the agent find the recipe?",
      screenshotPaths: ["a.png"],
      readAsBase64: readAsBase64,
    });

    expect(blocks[0]).toEqual({ type: "text", text: "Did the agent find the recipe?" });
  });

  it("carries every screenshot in capture order", () => {
    const blocks = buildJudgeContentBlocks({
      prompt: "p",
      screenshotPaths: ["first.png", "second.png"],
      readAsBase64: readAsBase64,
    });

    expect(blocks.slice(1)).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "bytes-of-first.png" },
      },
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "bytes-of-second.png" },
      },
    ]);
  });

  it("labels a jpeg by its own media type rather than assuming png", () => {
    const blocks = buildJudgeContentBlocks({
      prompt: "p",
      screenshotPaths: ["shot.jpg"],
      readAsBase64: readAsBase64,
    });

    expect(blocks[1]).toMatchObject({ source: { media_type: "image/jpeg" } });
  });

  it("judges on the answer alone when the attempt captured nothing", () => {
    const blocks = buildJudgeContentBlocks({
      prompt: "p",
      screenshotPaths: [],
      readAsBase64: readAsBase64,
    });

    expect(blocks).toHaveLength(1);
  });
});

describe("createClaudeJudgeInvoker", () => {
  it("returns the judge's text so the protocol can read its verdict line", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Looks right.\nStatus: SUCCESS" }],
    });

    const invokeJudgeAsync = createClaudeJudgeInvoker({
      client: { messages: { create: createMessage } } as never,
      readAsBase64: readAsBase64,
    });

    expect(await invokeJudgeAsync("Did it work?", [])).toBe("Looks right.\nStatus: SUCCESS");
  });

  it("joins every text block, so a verdict split across blocks still parses", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "Reasoning." },
        { type: "text", text: "Status: SUCCESS" },
      ],
    });

    const invokeJudgeAsync = createClaudeJudgeInvoker({
      client: { messages: { create: createMessage } } as never,
      readAsBase64: readAsBase64,
    });

    expect(await invokeJudgeAsync("p", [])).toBe("Reasoning.\nStatus: SUCCESS");
  });

  it("throws when the judge refuses, rather than scoring the task a failure", async () => {
    // A refusal returns HTTP 200 with empty content. Read as a verdict it would
    // silently score the task "not success" and understate the agent's ability.
    const createMessage = vi.fn().mockResolvedValue({
      stop_reason: "refusal",
      stop_details: { category: "cyber" },
      content: [],
    });

    const invokeJudgeAsync = createClaudeJudgeInvoker({
      client: { messages: { create: createMessage } } as never,
      readAsBase64: readAsBase64,
    });

    await expect(invokeJudgeAsync("p", [])).rejects.toThrow(/refused/i);
  });

  it("throws when the judge is cut off mid-verdict", async () => {
    const createMessage = vi.fn().mockResolvedValue({
      stop_reason: "max_tokens",
      content: [{ type: "text", text: "Partial reasoning" }],
    });

    const invokeJudgeAsync = createClaudeJudgeInvoker({
      client: { messages: { create: createMessage } } as never,
      readAsBase64: readAsBase64,
    });

    await expect(invokeJudgeAsync("p", [])).rejects.toThrow(/max_tokens/i);
  });
});
