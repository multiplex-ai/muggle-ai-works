import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@anthropic-ai/claude-agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@anthropic-ai/claude-agent-sdk")>()),
  query: sdk.query,
}));

const { runAgentScenarioOnce } = await import("../src/harness.js");
const { EvalTargetKind } = await import("../src/types.js");

/** A stream carrying only a terminal result, which is all the harness needs to judge a run. */
function resultStream(text: string): AsyncGenerator<unknown> {
  return (async function* () {
    yield { type: "result", subtype: "success", result: text };
  })();
}

interface CapturedOptions {
  settingSources?: unknown[];
  strictMcpConfig?: boolean;
  persistSession?: boolean;
  cwd?: string;
  tools?: string[];
  hooks?: { PreToolUse?: unknown[] };
  mcpServers?: Record<string, unknown>;
  systemPrompt?: unknown;
  model?: string;
}

function lastQuery(): { prompt: string; options: CapturedOptions } {
  return sdk.query.mock.calls[sdk.query.mock.calls.length - 1][0] as { prompt: string; options: CapturedOptions };
}

describe("agent run isolation", () => {
  it("loads no filesystem settings or ambient MCP servers, and keeps no transcript", async () => {
    sdk.query.mockReturnValue(resultStream("READY"));

    await runAgentScenarioOnce({
      definition: {
        kind: EvalTargetKind.Agent,
        name: "a",
        modelAlias: "sonnet",
        model: "claude-sonnet-4-6",
        body: "contract",
        filePath: "/repo/plugin/agents/a.md",
      },
      scenario: { name: "s", prompt: "go", expect: { outputContains: ["READY"] } },
    });

    const { options } = lastQuery();
    // Omitting this loads every settings source. This repo's .claude/settings.json
    // enables the muggle plugin, whose Stop guardrails then fire inside the eval and
    // replace the agent's final report with a reply to the guardrail — which is what
    // held agent-gate-eval red.
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.persistSession).toBe(false);
    expect(options.tools).toEqual(["Read", "Bash", "AskUserQuestion"]);
    expect(options.mcpServers).toBeUndefined();
    expect(options.hooks?.PreToolUse).toHaveLength(1);
  });

  it("works in a per-run sandbox it removes afterwards", async () => {
    sdk.query.mockReturnValue(resultStream("READY"));

    await runAgentScenarioOnce({
      definition: {
        kind: EvalTargetKind.Agent,
        name: "a",
        modelAlias: "sonnet",
        model: "claude-sonnet-4-6",
        body: "contract",
        filePath: "/repo/plugin/agents/a.md",
      },
      scenario: { name: "s", prompt: "go", seed: { repo: "tiny-web-app" }, expect: {} },
    });

    const { options } = lastQuery();
    expect(options.cwd?.startsWith(os.tmpdir())).toBe(true);
    expect(fs.existsSync(options.cwd!)).toBe(false);
  });
});

describe("skill run setup", () => {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agent-gate-eval-plugin-"));
  fs.mkdirSync(path.join(pluginRoot, "skills", "demo"), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, "config"));
  fs.writeFileSync(path.join(pluginRoot, "config", "preference-defaults.json"), JSON.stringify({ autoCreatePR: "always" }));
  const skillDir = path.join(pluginRoot, "skills", "demo");

  it("invokes the skill as the Skill tool injects it, on Claude Code's prompt plus the SessionStart preferences", async () => {
    sdk.query.mockReturnValue(resultStream("done"));

    await runAgentScenarioOnce({
      definition: {
        kind: EvalTargetKind.Skill,
        name: "demo",
        model: "claude-sonnet-5-5",
        body: "# Demo\nDo the thing.",
        filePath: path.join(skillDir, "SKILL.md"),
        baseDir: skillDir,
      },
      scenario: {
        name: "s",
        prompt: "rebase on https://github.com/o/r/pull/1 slug=s",
        preferences: { autoCreatePR: "never" },
        expect: {},
      },
    });

    const { prompt, options } = lastQuery();
    expect(prompt.startsWith("<command-name>/demo</command-name>\n<command-args>rebase on")).toBe(true);
    expect(prompt).toContain(`Base directory for this skill: ${skillDir}\n\n# Demo`);
    expect(prompt.endsWith("ARGUMENTS: rebase on https://github.com/o/r/pull/1 slug=s")).toBe(true);
    const systemPrompt = options.systemPrompt as { type: string; preset: string; append: string };
    expect(systemPrompt.preset).toBe("claude_code");
    expect(systemPrompt.append).toContain("Muggle Test Preferences (~/.muggle-ai/preferences.json):\nautoCreatePR=never");
    expect(options.tools).toEqual(["Read", "Write", "Edit", "Bash", "AskUserQuestion"]);
    expect(Object.keys(options.mcpServers ?? {}).sort()).toEqual(["eval_host", "eval_mock"]);
    expect(options.model).toBe("claude-sonnet-5-5");
  });
});
