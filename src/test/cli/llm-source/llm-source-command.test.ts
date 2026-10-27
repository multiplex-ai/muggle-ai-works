import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const llmSourceMocks = vi.hoisted(() => ({
  applyLlmSourceSelection: vi.fn(),
  resolveLlmSourceStatus: vi.fn(() => ({ source: "muggle-credit" })),
  buildLlmSourcePlan: vi.fn(() => ({ header: "LLM source", options: [], current: { source: "muggle-credit" } })),
}));

vi.mock("../../../../packages/mcps/src/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../packages/mcps/src/index.js")>();
  return {
    ...actual,
    applyLlmSourceSelection: llmSourceMocks.applyLlmSourceSelection,
    resolveLlmSourceStatus: llmSourceMocks.resolveLlmSourceStatus,
    buildLlmSourcePlan: llmSourceMocks.buildLlmSourcePlan,
  };
});

const { llmSourceCommand } = await import("../../../cli/llm-source/llm-source-command.js");

let logLines: string[];
let errorLines: string[];
const originalIsTTY = process.stdin.isTTY;

function setStdinIsTTY(isTTY: boolean): void {
  Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
}

beforeEach(() => {
  logLines = [];
  errorLines = [];
  vi.spyOn(console, "log").mockImplementation((line?: unknown) => {
    logLines.push(String(line ?? ""));
  });
  vi.spyOn(console, "error").mockImplementation((line?: unknown) => {
    errorLines.push(String(line ?? ""));
  });
  llmSourceMocks.applyLlmSourceSelection.mockReset();
  llmSourceMocks.applyLlmSourceSelection.mockReturnValue({ source: "muggle-credit" });
  setStdinIsTTY(false);
  process.exitCode = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  setStdinIsTTY(originalIsTTY as boolean);
  process.exitCode = undefined;
});

describe("muggle llm-source", () => {
  it("--show prints the source in effect", async () => {
    await llmSourceCommand({ show: true });

    expect(logLines).toEqual(["LLM source: Muggle AI credit"]);
  });

  it("--json emits the question for an agent front-end", async () => {
    await llmSourceCommand({ json: true });

    expect(JSON.parse(logLines.join("\n")).header).toBe("LLM source");
  });

  it("--use local-model applies the endpoint from flags", async () => {
    await llmSourceCommand({ use: "local-model", baseUrl: "http://localhost:11434/v1", model: "qwen2.5vl" });

    expect(llmSourceMocks.applyLlmSourceSelection).toHaveBeenCalledWith({
      source: "local-model",
      localBaseUrl: "http://localhost:11434/v1",
      localModel: "qwen2.5vl",
    });
    expect(logLines.join("\n")).toContain("Saved.");
  });

  it("--use reports a rejected selection and exits non-zero", async () => {
    llmSourceMocks.applyLlmSourceSelection.mockImplementation(() => {
      throw new Error("A local model needs the model name the endpoint serves.");
    });

    await llmSourceCommand({ use: "local-model", baseUrl: "http://localhost:11434/v1" });

    expect(errorLines.join("\n")).toContain("model name");
    expect(process.exitCode).toBe(1);
  });

  it("--use claude-code applies without a terminal, since it takes no secret", async () => {
    llmSourceMocks.applyLlmSourceSelection.mockReturnValue({ source: "claude-code" });

    await llmSourceCommand({ use: "claude-code" });

    expect(llmSourceMocks.applyLlmSourceSelection).toHaveBeenCalledWith(
      expect.objectContaining({ source: "claude-code" }),
    );
    expect(logLines).toEqual(["Saved. LLM source: Your Claude Code"]);
    expect(process.exitCode).toBeUndefined();
  });

  it("--use claude-code relays Claude Code's refusal and exits non-zero", async () => {
    llmSourceMocks.applyLlmSourceSelection.mockImplementation(() => {
      throw new Error("Claude Code 2.1.308 (Claude Code) is not signed in. Sign in by running `claude`.");
    });

    await llmSourceCommand({ use: "claude-code" });

    expect(errorLines.join("\n")).toContain("is not signed in");
    expect(process.exitCode).toBe(1);
  });

  it("--use rejects an unknown source", async () => {
    await llmSourceCommand({ use: "claude-subscription" });

    expect(errorLines.join("\n")).toContain("muggle-credit, anthropic-api-key, local-model, claude-code");
    expect(llmSourceMocks.applyLlmSourceSelection).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("never takes an Anthropic key outside a terminal", async () => {
    await llmSourceCommand({ use: "anthropic-api-key" });

    expect(errorLines.join("\n")).toContain("hidden terminal prompt");
    expect(llmSourceMocks.applyLlmSourceSelection).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("refuses the interactive question without a terminal", async () => {
    await llmSourceCommand({});

    expect(errorLines.join("\n")).toContain("--show");
    expect(process.exitCode).toBe(1);
  });
});
