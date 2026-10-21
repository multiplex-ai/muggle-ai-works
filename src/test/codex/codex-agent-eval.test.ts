import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadAgentDefinition } from "../../../internal/agent-gate-eval/src/agent-definition.js";
import { prepareCodexAgentHome, runAgentScenarioOnceInCodex } from "../../../internal/agent-gate-eval/src/codex-harness.js";
import type { AgentRunVerdict, AgentScenario } from "../../../internal/agent-gate-eval/src/types.js";
import { CODEX_BIN, REPO_ROOT, mockModelOverrides, writeMockModelCatalog } from "./support/codexSession.js";
import { MockResponsesServer, assistantMessage, muggleToolCall, shellCall, toolCallOutput } from "./support/mockResponsesServer.js";
import type { ModelRequest, ResponseStreamEvent, ScriptedTurn } from "./support/types.js";

// The agent-gate eval's Codex harness (internal/agent-gate-eval, `--host
// codex`) against the real Codex CLI and a scripted model: scripted shell
// output, real reads of the plugin tree and nothing outside it, the mock muggle
// tools, and the no-user rule. The model-driven runs need a real model and live
// in codex-skill-eval.yml; this is the plumbing they stand on.
//
// Runs with the rest of the live suite (CODEX_BIN set).

const LIVE_TIMEOUT_MS = 180_000;
const SIMULATED = "SIMULATED OUTPUT (treat as the command's real result):";

/** A function call to one of Codex's own tools. */
function codexToolCall(callId: string, name: string, args: Record<string, unknown>): ResponseStreamEvent[] {
  return [
    { type: "response.output_item.done", item: { type: "function_call", call_id: callId, name: name, arguments: JSON.stringify(args) } },
    ...assistantMessage("").slice(1),
  ];
}

describe.skipIf(!CODEX_BIN)("the agent-gate eval's Codex harness in a real Codex", () => {
  const model = new MockResponsesServer();
  const codexHome = mkdtempSync(join(tmpdir(), "codex-agent-home-"));
  const definition = loadAgentDefinition(join(REPO_ROOT, "plugin", "agents"), "test-prepare-runner");
  let configOverrides: string[];

  async function run(scenario: AgentScenario, script: ScriptedTurn): Promise<{ verdict: AgentRunVerdict; requests: ModelRequest[] }> {
    model.useScript(script);
    const verdict = await runAgentScenarioOnceInCodex({
      definition: definition,
      scenario: scenario,
      codexHome: codexHome,
      // The reads that really run only read; a runner without user namespaces cannot start Codex's sandbox.
      sandbox: "danger-full-access",
      configOverrides: configOverrides,
    });
    return { verdict: verdict, requests: [...model.requests] };
  }

  beforeAll(async () => {
    await model.start();
    prepareCodexAgentHome(codexHome);
    configOverrides = mockModelOverrides(model, writeMockModelCatalog(codexHome));
  });

  afterAll(async () => {
    await model.stop();
  });

  // The scripted model reports only what reached it, so the verdict proves the channel.
  it("answers a shell call with its scripted output, marked as the agent SDK harness marks it", async () => {
    const { verdict } = await run(
      {
        name: "scripted",
        prompt: "Prepare the environment.",
        bashResponses: [{ commandContains: "curl", response: "HTTP/1.1 200 OK" }],
        expect: { outputContains: ["READY"], requireToolAttempts: [{ tool: "Bash", argContains: "curl -sI" }] },
      },
      (request, index) => {
        if (index === 0) return shellCall("probe", "curl -sI http://localhost:3000");
        const output = toolCallOutput(request, "probe");
        return assistantMessage(output.includes(`${SIMULATED}\nHTTP/1.1 200 OK`) ? "READY" : `DEGRADED: ${output}`);
      },
    );
    expect(verdict.reasons).toEqual([]);
  }, LIVE_TIMEOUT_MS);

  it("lets the agent really read the plugin tree, and scripts every read outside it", async () => {
    const inside = join(REPO_ROOT, "plugin", "agents", "test-prepare-runner.md");
    const outside = join(REPO_ROOT, "package.json");
    const { verdict } = await run(
      { name: "reads", prompt: "Prepare the environment.", expect: { outputContains: ["inside=real outside=scripted"] } },
      (request, index) => {
        if (index === 0) return shellCall("inside", `cat '${inside}'`);
        if (index === 1) return shellCall("outside", `cat '${outside}'`);
        const real = toolCallOutput(request, "inside").includes("name: test-prepare-runner");
        const scripted = toolCallOutput(request, "outside").includes(`${SIMULATED}\n(exit 0, no output)`);
        return assistantMessage(`READY inside=${real ? "real" : "missing"} outside=${scripted ? "scripted" : "leaked"}`);
      },
    );
    expect(verdict.reasons).toEqual([]);
  }, LIVE_TIMEOUT_MS);

  it("serves the mock muggle tools for a scenario with fixtures, under the names scenarios use", async () => {
    const { verdict, requests } = await run(
      {
        name: "mcp",
        prompt: "Run the replay.",
        fixtures: {},
        expect: { outputContains: ["PASS"], requireToolAttempts: [{ tool: "muggle-local-execute-replay", argContains: "showUi" }] },
      },
      (_request, index) => (index === 0 ? muggleToolCall("replay", "muggle-local-execute-replay", { showUi: false }) : assistantMessage("PASS")),
    );
    expect(verdict.reasons).toEqual([]);
    expect((requests[0].tools ?? []).map((tool) => tool.name)).toContain("mcp__muggle");
  }, LIVE_TIMEOUT_MS);

  it("offers no muggle tools to a scenario without fixtures", async () => {
    const { requests } = await run(
      { name: "no-mcp", prompt: "Prepare the environment.", expect: {} },
      () => assistantMessage("READY"),
    );
    expect((requests[0].tools ?? []).map((tool) => tool.name)).not.toContain("mcp__muggle");
  }, LIVE_TIMEOUT_MS);

  it("denies request_user_input and fails an agent that asks, as there is no user", async () => {
    let denial = "";
    const { verdict } = await run(
      { name: "asks", prompt: "Prepare the environment.", expect: { outputContains: ["needs-input:"] } },
      (request, index) => {
        if (index === 0) return codexToolCall("ask", "request_user_input", { questions: [{ id: "url", header: "URL", question: "Which dev server URL?", options: [{ label: "http://localhost:3000", description: "" }] }] });
        denial = toolCallOutput(request, "ask");
        return assistantMessage("needs-input: the dev server URL");
      },
    );
    expect(denial).toContain("there is no user in this environment");
    expect(verdict.trace.askQuestionCount).toBe(1);
    expect(verdict.reasons).toEqual([
      "agent asked the user 1 time(s) — the no-user-channel contract requires needs-input: instead",
    ]);
  }, LIVE_TIMEOUT_MS);
});
