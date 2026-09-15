import { describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: sdk.query }));

const { runAgentScenarioOnce } = await import("../src/harness.js");

/** A stream carrying only a terminal result, which is all the harness needs to judge a run. */
function resultStream(text: string): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: "result", subtype: "success", result: text };
  })();
}

describe("agent run isolation", () => {
  it("loads no filesystem settings, so ambient plugins and hooks cannot reach the agent", async () => {
    sdk.query.mockReturnValue(resultStream("READY"));

    await runAgentScenarioOnce({
      definition: {
        name: "a",
        modelAlias: "sonnet",
        model: "claude-sonnet-4-6",
        body: "contract",
        filePath: "/repo/plugin/agents/a.md",
      },
      scenario: { name: "s", prompt: "go", expect: { outputContains: ["READY"] } },
    });

    expect(sdk.query).toHaveBeenCalledTimes(1);
    const { options } = sdk.query.mock.calls[0][0] as {
      options: { settingSources?: unknown[] };
    };

    // Omitting this loads every settings source. This repo's .claude/settings.json
    // enables the muggle plugin, whose Stop guardrails then fire inside the eval and
    // replace the agent's final report with a reply to the guardrail — which is what
    // held agent-gate-eval red.
    expect(options.settingSources).toEqual([]);
  });
});
