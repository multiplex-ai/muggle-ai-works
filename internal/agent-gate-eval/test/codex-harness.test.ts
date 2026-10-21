import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { mockToolNamesByCodexName } from "../../skill-gate-eval/src/codex-cli.js";
import { CODEX_EVAL_HOME_MARKER } from "../../skill-gate-eval/src/constants.js";
import {
  buildCodexAgentInstructions,
  codexUnsupportedFeatures,
  prepareCodexAgentHome,
  readCodexAgentTrace,
} from "../src/codex-harness.js";
import {
  CODEX_AGENT_BASH_ENV,
  CODEX_AGENT_READ_ROOT_ENV,
  CODEX_AGENT_TRACE_ENV,
  UNSCRIPTED_BASH_RESPONSE,
} from "../src/constants.js";
import { pluginRootOf } from "../src/target-definition.js";
import { resolveScriptedBashResponse } from "../src/tools/scripted-replies.js";
import {
  EvalTargetKind,
  type CodexAgentRunOptions,
  type CodexAgentTraceEntry,
  type ScriptedBashResponse,
} from "../src/types.js";

const AGENT_HOOK = fileURLToPath(new URL("../src/codex-agent-hook.mjs", import.meta.url));
const SIMULATED = "SIMULATED OUTPUT (treat as the command's real result):\n";

const repo = mkdtempSync(path.join(tmpdir(), "codex-agent-repo-"));
const pluginTree = path.join(repo, "plugin");
mkdirSync(path.join(pluginTree, "agents"), { recursive: true });
const agentFile = path.join(pluginTree, "agents", "runner.md");
writeFileSync(agentFile, "---\nname: runner\nmodel: haiku\n---\nbody");

/** The hook's answer to one shell call made from `cwd`: "ran" when it let a plugin read through, else the scripted output it gave. */
function hookAnswer(command: string, responses: ScriptedBashResponse[] = [], cwd = repo): string {
  const scratch = mkdtempSync(path.join(tmpdir(), "codex-agent-hook-"));
  const scripted = path.join(scratch, "scripted.json");
  writeFileSync(scripted, JSON.stringify({ responses: responses, unscripted: UNSCRIPTED_BASH_RESPONSE }));
  const run = spawnSync(process.execPath, [AGENT_HOOK], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", cwd: cwd, tool_name: "Bash", tool_input: { command: command } }),
    encoding: "utf-8",
    env: {
      ...process.env,
      [CODEX_AGENT_TRACE_ENV]: path.join(scratch, "trace.jsonl"),
      [CODEX_AGENT_BASH_ENV]: scripted,
      [CODEX_AGENT_READ_ROOT_ENV]: pluginTree,
    },
  });
  expect(run.status, run.stderr).toBe(0);
  if (run.stdout === "{}") return "ran";
  const reason = (JSON.parse(run.stdout) as { hookSpecificOutput: { permissionDecisionReason: string } }).hookSpecificOutput
    .permissionDecisionReason;
  expect(reason.startsWith(SIMULATED), reason).toBe(true);
  return reason.slice(SIMULATED.length);
}

function decide(toolName: string): string {
  const run = spawnSync(process.execPath, [AGENT_HOOK], {
    input: JSON.stringify({ tool_name: toolName, tool_input: {} }),
    encoding: "utf-8",
    env: { ...process.env, [CODEX_AGENT_READ_ROOT_ENV]: pluginTree },
  });
  return run.stdout;
}

describe("the Codex agent hook", () => {
  const quoted = (file: string) => `'${file}'`;

  it("lets a plain read of the plugin tree run, as the agent SDK harness's Read does", () => {
    for (const command of [
      `cat ${quoted(agentFile)}`,
      `sed -n '1,200p' ${quoted(agentFile)}`,
      `nl -ba ${quoted(agentFile)} | sed -n '1,80p'`,
      `ls ${quoted(path.join(pluginTree, "agents"))}`,
      `Get-Content -Raw ${quoted(agentFile)}`,
    ]) {
      expect(hookAnswer(command), command).toBe("ran");
    }
  });

  it("resolves a relative path from the call's own cwd", () => {
    expect(hookAnswer(`cat ${path.join("agents", "runner.md")}`, [], pluginTree)).toBe("ran");
    expect(hookAnswer(`cat ${path.join("agents", "runner.md")}`, [], repo)).toBe(UNSCRIPTED_BASH_RESPONSE);
  });

  it("scripts every command that does more than read the plugin tree", () => {
    for (const command of [
      `cat ${quoted(path.join(repo, "package.json"))}`,
      `cat ${quoted(path.join(pluginTree, "..", "package.json"))}`,
      `cat ${quoted(agentFile)} > ${quoted(path.join(repo, "copy.md"))}`,
      `cat ${quoted(agentFile)}; rm -rf ${quoted(pluginTree)}`,
      `cat ${quoted(agentFile)} && git push`,
      `sed -i 's/a/b/' ${quoted(agentFile)}`,
      `cat "$CLAUDE_PLUGIN_ROOT/agents/runner.md"`,
      "git status",
      "ls",
    ]) {
      expect(hookAnswer(command), command).toBe(UNSCRIPTED_BASH_RESPONSE);
    }
  });

  // The hook mirrors harness.ts's first-match rule rather than importing it; any drift shows here.
  it("scripts the output the agent SDK harness would, for the same command", () => {
    const responses = [
      { commandContains: "build-pr-section", response: "rendered" },
      { commandContains: "issues/1/comments", response: "" },
      { commandContains: "gh", response: "gh output" },
    ];
    for (const command of ["echo x | muggle build-pr-section", "gh api repos/o/r/issues/1/comments", "gh pr view 7", "curl -s localhost"]) {
      expect(hookAnswer(command, responses), command).toBe(resolveScriptedBashResponse(command, responses));
    }
  });

  it("lets a mock muggle call through, and denies asking and every other tool", () => {
    expect(decide("mcp__muggle__muggle_local_execute_replay")).toBe("{}");
    expect(decide("request_user_input")).toContain("there is no user in this environment");
    expect(decide("apply_patch")).toContain("[harness] tool apply_patch is not available in this eval");
  });
});

describe("the Codex agent harness", () => {
  const options: Pick<CodexAgentRunOptions, "definition" | "scenario"> = {
    definition: {
      kind: EvalTargetKind.Agent,
      name: "runner",
      modelAlias: "haiku",
      model: "m",
      body: "AGENT_BODY_MARKER",
      filePath: agentFile,
    },
    scenario: { name: "s", prompt: "go", expect: {} },
  };

  it("scopes real reads to the definition's plugin tree", () => {
    expect(pluginRootOf(options.definition)).toBe(pluginTree);
  });

  it("names every scenario feature its stateless hook and missing sandbox cannot honor", () => {
    expect(codexUnsupportedFeatures(options.scenario)).toEqual([]);
    expect(
      codexUnsupportedFeatures({
        ...options.scenario,
        bashResponses: [{ commandContains: "gh", sequence: ["red", "green"] }],
        fixtures: { executeResult: { sequence: [{ status: "failed" }, { status: "passed" }] } },
        seed: { repo: "tiny-web-app" },
        toolResponses: {},
        expect: { requireArtifacts: [{ path: "~/x" }] },
      }),
    ).toEqual(["bashResponses sequence", "fixtures sequence", "seed", "toolResponses", "requireArtifacts"]);
  });

  it("gives the agent its definition and the Codex note, and names the mock tools only when the scenario has fixtures", () => {
    const withoutFixtures = buildCodexAgentInstructions(options);
    expect(withoutFixtures).toContain("AGENT_BODY_MARKER");
    expect(withoutFixtures).toContain(`Your definition file lives at ${agentFile}`);
    expect(withoutFixtures).toContain("marked SIMULATED OUTPUT");
    expect(withoutFixtures).not.toContain("muggle MCP tools");
    const withFixtures = buildCodexAgentInstructions({ ...options, scenario: { ...options.scenario, fixtures: {} } });
    expect(withFixtures).toContain("muggle MCP tools here return canned results");
  });

  it("names traced calls as the agent SDK harness does, and counts each ask", () => {
    const trace = path.join(mkdtempSync(path.join(tmpdir(), "codex-agent-trace-")), "trace.jsonl");
    const entries: CodexAgentTraceEntry[] = [
      { tool_name: "Bash", tool_input: { command: "gh pr view 7" } },
      { tool_name: "mcp__muggle__muggle_local_execute_replay", tool_input: { showUi: false } },
      { tool_name: "request_user_input", tool_input: { questions: [] } },
    ];
    writeFileSync(trace, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
    const { toolAttempts, askQuestionCount } = readCodexAgentTrace(trace, mockToolNamesByCodexName({}));
    expect(toolAttempts).toEqual([
      { tool: "Bash", args: { command: "gh pr view 7" } },
      { tool: "muggle-local-execute-replay", args: { showUi: false } },
      { tool: "request_user_input", args: { questions: [] } },
    ]);
    expect(askQuestionCount).toBe(1);
  });

  it("keeps the shell on in the Codex home it owns, and never overwrites someone's own", () => {
    const codexHome = mkdtempSync(path.join(tmpdir(), "codex-agent-home-"));
    prepareCodexAgentHome(codexHome);
    const config = readFileSync(path.join(codexHome, "config.toml"), "utf-8");
    expect(config.startsWith(CODEX_EVAL_HOME_MARKER)).toBe(true);
    expect(config).not.toContain("shell_tool");
    expect(readFileSync(path.join(codexHome, "hooks.json"), "utf-8")).toContain("codex-agent-hook.mjs");

    const someonesHome = mkdtempSync(path.join(tmpdir(), "codex-real-home-"));
    writeFileSync(path.join(someonesHome, "config.toml"), 'model = "gpt-5.5"\n');
    expect(() => prepareCodexAgentHome(someonesHome)).toThrow(/refusing to overwrite/);
  });
});
