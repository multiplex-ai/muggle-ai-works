import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { prepareCodexGateHome, runScenarioOnceInCodex } from "../../../internal/skill-gate-eval/src/codex-harness.js";
import type { RunVerdict, Scenario, ScenarioFile } from "../../../internal/skill-gate-eval/src/types.js";
import { PreferenceValue } from "../../../internal/skill-gate-eval/src/types.js";
import { CODEX_BIN, REPO_ROOT, mockModelOverrides, writeMockModelCatalog } from "./support/codexSession.js";
import {
  MockResponsesServer,
  assistantMessage,
  messageTexts,
  muggleToolCall,
  toolCallOutput,
} from "./support/mockResponsesServer.js";
import type { ModelRequest, ResponseStreamEvent, ScriptedTurn } from "./support/types.js";

// The skill-gate eval's Codex harness (internal/skill-gate-eval, `--host
// codex`) against the real Codex CLI and a scripted model: the prompt and tools
// a run offers, both ways a gate's question is answered, the tools it denies,
// and the verdict it reaches. The model-driven runs need a real model and live
// in codex-skill-eval.yml; this is the plumbing they stand on.
//
// Runs with the rest of the live suite (CODEX_BIN set).

const LIVE_TIMEOUT_MS = 180_000;
const EXECUTE_TOOL = "muggle-local-execute-test-generation";
const GATE_QUESTION = "Show the test browser as it runs?";

/** A function call to one of Codex's own tools. */
function codexToolCall(callId: string, name: string, args: Record<string, unknown>): ResponseStreamEvent[] {
  return [
    { type: "response.output_item.done", item: { type: "function_call", call_id: callId, name: name, arguments: JSON.stringify(args) } },
    ...assistantMessage("").slice(1),
  ];
}

function scenario(overrides: Partial<Scenario> & Pick<Scenario, "expect">): Scenario {
  return {
    name: "codex-plumbing",
    preferences: { showElectronBrowser: PreferenceValue.Ask, autoLogin: PreferenceValue.Always },
    userPrompt: "test the signup flow on http://localhost:3000",
    askQuestionAnswers: [{ questionContains: "Show the test browser", answer: "Show it" }],
    ...overrides,
  };
}

describe.skipIf(!CODEX_BIN)("the skill-gate eval's Codex harness in a real Codex", () => {
  const model = new MockResponsesServer();
  const codexHome = mkdtempSync(join(tmpdir(), "codex-gate-home-"));
  const scenarioDir = mkdtempSync(join(tmpdir(), "codex-gate-scenarios-"));
  const scenarioFile: ScenarioFile = {
    skill: "muggle-test-feature-local",
    gate: "showElectronBrowser",
    fixturesPath: "./fixtures.json",
    scenarios: [],
  };
  let configOverrides: string[];

  async function run(runScenario: Scenario, script: ScriptedTurn): Promise<{ verdict: RunVerdict; requests: ModelRequest[] }> {
    model.useScript(script);
    const verdict = await runScenarioOnceInCodex({
      scenarioFile: scenarioFile,
      scenarioFilePath: join(scenarioDir, "scenarios.json"),
      scenario: runScenario,
      skillsDir: join(REPO_ROOT, "plugin", "skills"),
      codexHome: codexHome,
      configOverrides: configOverrides,
    });
    return { verdict: verdict, requests: [...model.requests] };
  }

  beforeAll(async () => {
    await model.start();
    writeFileSync(join(scenarioDir, "fixtures.json"), "{}");
    prepareCodexGateHome(codexHome, {});
    configOverrides = mockModelOverrides(model, writeMockModelCatalog(codexHome));
  });

  afterAll(async () => {
    await model.stop();
  });

  it("offers the skill, its gate contract and the Codex question rule, with only the mock muggle tools", async () => {
    const { verdict, requests } = await run(
      scenario({ expect: { askQuestionForGate: false, gateQuestionSubstring: "Show the test browser" } }),
      () => assistantMessage("Nothing to do."),
    );
    const instructions = messageTexts(requests[0], "developer").join("\n");
    expect(instructions).toContain("name: muggle-test-feature-local");
    expect(instructions).toContain("# Preference gate contract — preference-gates/showElectronBrowser.md");
    expect(instructions).toContain(GATE_QUESTION);
    expect(instructions).toContain("Muggle Test Preferences: showElectronBrowser=ask autoLogin=always");
    expect(instructions).toContain("Where the skill says AskUserQuestion: `request_user_input` where Codex offers it.");
    const toolNames = (requests[0].tools ?? []).map((tool) => tool.name);
    expect(toolNames).toContain("mcp__muggle");
    expect(toolNames).toContain("request_user_input");
    for (const removed of ["exec_command", "view_image", "create_goal", "spawn_agent"]) {
      expect(toolNames, removed).not.toContain(removed);
    }
    expect(verdict.pass).toBe(true);
  }, LIVE_TIMEOUT_MS);

  // The pick only reaches the model through the hook's denial, so the scripted
  // model passes showUi:true only if it arrived — the verdict proves the channel.
  it("answers request_user_input with the scenario's pick, the way the agent SDK harness answers AskUserQuestion", async () => {
    const { verdict } = await run(
      scenario({ expect: { askQuestionForGate: true, gateQuestionSubstring: "Show the test browser", executeTool: EXECUTE_TOOL, executeArgs: { showUi: true } } }),
      (request, index) => {
        if (index === 0) {
          return codexToolCall("ask", "request_user_input", {
            questions: [{ id: "browser", header: "Browser window", question: GATE_QUESTION, options: [{ label: "Show it", description: "" }, { label: "Hide it", description: "" }] }],
          });
        }
        if (index === 1) {
          return muggleToolCall("run", EXECUTE_TOOL, { showUi: toolCallOutput(request, "ask").includes('User selected: "Show it"') });
        }
        return assistantMessage("Done.");
      },
    );
    expect(verdict.reasons).toEqual([]);
    expect(verdict.trace.askQuestions).toEqual([{ question: GATE_QUESTION, answer: "Show it" }]);
    expect(verdict.trace.mcpCalls).toEqual([{ tool: EXECUTE_TOOL, args: { showUi: true } }]);
  }, LIVE_TIMEOUT_MS);

  it("answers a question a turn ended on by resuming the thread with the pick", async () => {
    const asked = `${GATE_QUESTION}\n1. Show it\n2. Hide it`;
    const { verdict, requests } = await run(
      scenario({ expect: { askQuestionForGate: true, gateQuestionSubstring: "Show the test browser", executeTool: EXECUTE_TOOL, executeArgs: { showUi: true } } }),
      (request, index) => {
        if (index === 0) return assistantMessage(asked);
        if (index === 1) return muggleToolCall("run", EXECUTE_TOOL, { showUi: messageTexts(request, "user").at(-1) === "Show it" });
        return assistantMessage("Done.");
      },
    );
    expect(verdict.reasons).toEqual([]);
    expect(verdict.trace.askQuestions).toEqual([{ question: asked, answer: "Show it" }]);
    expect(requests.length).toBeGreaterThanOrEqual(3);
  }, LIVE_TIMEOUT_MS);

  it("denies every tool but the mock muggle ones, and tells the model why", async () => {
    let denial = "";
    const { verdict } = await run(
      scenario({ expect: { askQuestionForGate: false, gateQuestionSubstring: "Show the test browser", executeTool: EXECUTE_TOOL, executeArgs: { showUi: false } } }),
      (request, index) => {
        if (index === 0) return codexToolCall("resources", "list_mcp_resources", {});
        if (index === 1) {
          denial = toolCallOutput(request, "resources");
          return muggleToolCall("run", EXECUTE_TOOL, { showUi: false });
        }
        return assistantMessage("Done.");
      },
    );
    expect(denial).toContain("[harness] tool list_mcp_resources is not available in this eval");
    expect(verdict.reasons).toEqual([]);
    expect(verdict.trace.mcpCalls).toEqual([{ tool: EXECUTE_TOOL, args: { showUi: false } }]);
  }, LIVE_TIMEOUT_MS);

  it("fails a run that broke its gate, and says how", async () => {
    const { verdict } = await run(
      scenario({
        preferences: { showElectronBrowser: PreferenceValue.Never },
        expect: { askQuestionForGate: false, gateQuestionSubstring: "Show the test browser", executeTool: EXECUTE_TOOL, executeArgs: { showUi: false } },
      }),
      (_request, index) => (index === 0 ? muggleToolCall("run", EXECUTE_TOOL, { showUi: true }) : assistantMessage("Done.")),
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons).toEqual([`expected showUi=false on ${EXECUTE_TOOL} but got true`]);
  }, LIVE_TIMEOUT_MS);
});
