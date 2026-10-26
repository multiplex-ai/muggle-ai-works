import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { AGENT_BUILTIN_TOOLS, NO_USER_RESPONSE, SKILL_BUILTIN_TOOLS } from "../src/constants.js";
import { decideToolUse, toPreToolUseOutput } from "../src/tools/policy.js";
import { createBashResponder, createToolResponder } from "../src/tools/scripted-replies.js";
import { scenarioToolName, sessionToolName, toolAttemptsInMessage } from "../src/tools/trace.js";
import { ScriptedTool, type ToolPolicyContext } from "../src/types.js";

const realHome = path.join(os.tmpdir(), "users", "dev");
const root = path.join(realHome, "AppData", "Local", "Temp", "muggle-agent-eval-run-1");
// The checkout sits under the real home, as it does on a developer machine and a CI runner.
const pluginRoot = path.join(realHome, "Github", "works", "plugin");

function skillContext(): ToolPolicyContext {
  const answerTool = createToolResponder({
    [ScriptedTool.AskUserQuestion]: [{ argContains: "Proceed", response: 'User selected: "Proceed"' }],
  });
  return {
    paths: {
      root: root,
      home: path.join(root, "home"),
      repo: path.join(root, "repo"),
      realHome: realHome,
      passthroughRoots: [pluginRoot],
    },
    pluginRoot: pluginRoot,
    builtinTools: SKILL_BUILTIN_TOOLS,
    hasHostStubs: true,
    answerBash: createBashResponder([{ commandContains: "pnpm test", sequence: ["1 failing", "all passing"] }]),
    answerQuestion: (serializedInput) => answerTool(ScriptedTool.AskUserQuestion, serializedInput),
  };
}

describe("decideToolUse — files", () => {
  it("lets Read open the plugin tree where it really is, and the sandbox", () => {
    const context = skillContext();
    const stageFile = path.join(pluginRoot, "skills", "do", "build.md");
    expect(decideToolUse("Read", { file_path: stageFile }, context)).toEqual({
      behavior: "allow",
      updatedInput: { file_path: stageFile },
    });
    expect(decideToolUse("Read", { file_path: path.join(root, "repo", "README.md") }, context).behavior).toBe("allow");
  });

  it("never reads a real file outside the plugin tree: the rest of the real home maps into the sandbox home, the rest of the disk is denied", () => {
    const context = skillContext();
    expect(decideToolUse("Read", { file_path: path.join(pluginRoot, "..", "package.json") }, context)).toEqual({
      behavior: "allow",
      updatedInput: { file_path: path.join(root, "home", "Github", "works", "package.json") },
    });
    expect(decideToolUse("Read", { file_path: path.join(os.tmpdir(), "elsewhere", "package.json") }, context).behavior).toBe("deny");
  });

  it("redirects a home path into the sandbox home through updatedInput", () => {
    const decision = decideToolUse(
      "Read",
      { file_path: path.join(realHome, ".muggle-ai", "muggle-do", "sessions", "s", "state.md"), limit: 20 },
      skillContext(),
    );
    expect(decision).toEqual({
      behavior: "allow",
      updatedInput: { file_path: path.join(root, "home", ".muggle-ai", "muggle-do", "sessions", "s", "state.md"), limit: 20 },
    });
  });

  it("confines Write and Edit to the sandbox; the plugin tree is read-only", () => {
    const context = skillContext();
    const written = decideToolUse("Write", { file_path: "~/.muggle-ai/muggle-do/sessions/s/prs.json", content: "{}" }, context);
    expect(written).toEqual({
      behavior: "allow",
      updatedInput: { file_path: path.join(root, "home", ".muggle-ai", "muggle-do", "sessions", "s", "prs.json"), content: "{}" },
    });
    const pluginEdit = decideToolUse("Edit", { file_path: path.join(pluginRoot, "skills", "do", "build.md") }, context);
    expect(pluginEdit.behavior).toBe("deny");
    expect(pluginEdit.behavior === "deny" && pluginEdit.message).toContain("read-only");
    expect(decideToolUse("Write", { file_path: path.join(os.tmpdir(), "x.txt") }, context).behavior).toBe("deny");
  });

  it("offers an agent target no Write at all", () => {
    const decision = decideToolUse(
      "Write",
      { file_path: path.join(root, "repo", "x") },
      { ...skillContext(), builtinTools: AGENT_BUILTIN_TOOLS, hasHostStubs: false },
    );
    expect(decision).toEqual({ behavior: "deny", message: "[harness] tool Write is not available in this eval" });
  });
});

describe("decideToolUse — scripted and stubbed tools", () => {
  it("answers Bash with its scripted output, advancing the sequence per call", () => {
    const context = skillContext();
    const first = decideToolUse("Bash", { command: "pnpm test" }, context);
    const second = decideToolUse("Bash", { command: "pnpm test" }, context);
    expect(first.behavior === "deny" && first.message).toMatch(/^SIMULATED OUTPUT[^\n]*\n1 failing$/);
    expect(second.behavior === "deny" && second.message).toMatch(/\nall passing$/);
  });

  it("answers AskUserQuestion from the script, or with there-is-no-user", () => {
    const context = skillContext();
    expect(decideToolUse(ScriptedTool.AskUserQuestion, { questions: [{ question: "Proceed?" }] }, context)).toEqual({
      behavior: "deny",
      message: 'User selected: "Proceed"',
    });
    expect(decideToolUse(ScriptedTool.AskUserQuestion, { questions: [{ question: "Port?" }] }, context)).toEqual({
      behavior: "deny",
      message: NO_USER_RESPONSE,
    });
  });

  it("lets mock muggle and host-stub calls run, and points stray built-ins at their stand-ins", () => {
    const context = skillContext();
    expect(decideToolUse("mcp__eval_mock__muggle-local-execute-replay", { showUi: false }, context).behavior).toBe("allow");
    expect(decideToolUse("mcp__eval_host__Skill", { skill: "muggle-test-prepare" }, context).behavior).toBe("allow");
    for (const builtin of ["Skill", "Agent", "Task", "TodoWrite", "CronCreate", "CronDelete", "Monitor"]) {
      const decision = decideToolUse(builtin, {}, context);
      expect(decision.behavior === "deny" && decision.message, builtin).toContain("mcp__eval_host__");
    }
    const production = decideToolUse("mcp__plugin_muggle_muggle__muggle-local-execute-replay", {}, context);
    expect(production.behavior === "deny" && production.message).toContain("mcp__eval_mock__muggle-local-execute-replay");
    expect(decideToolUse("WebFetch", {}, context).behavior).toBe("deny");
  });
});

describe("toPreToolUseOutput", () => {
  it("turns an allow into a hook allow carrying the rewritten input, and a deny into a hook deny with its reason", () => {
    expect(toPreToolUseOutput({ behavior: "allow", updatedInput: { file_path: "/x" } })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput: { file_path: "/x" } },
    });
    expect(toPreToolUseOutput({ behavior: "deny", message: "no" })).toEqual({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "no" },
    });
  });
});

describe("tool attempt trace", () => {
  it("records main-thread tool_use blocks in order, under the names scenarios use", () => {
    const message = {
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        content: [
          { type: "text", text: "reading" },
          { type: "tool_use", name: "Read", input: { file_path: "~/x" } },
          { type: "tool_use", name: "mcp__eval_host__Skill", input: { skill: "muggle-test-prepare" } },
          { type: "tool_use", name: "mcp__eval_mock__muggle-local-execute-replay", input: {} },
        ],
      },
    };
    expect(toolAttemptsInMessage(message)).toEqual([
      { tool: "Read", args: { file_path: "~/x" } },
      { tool: "Skill", args: { skill: "muggle-test-prepare" } },
      { tool: "muggle-local-execute-replay", args: {} },
    ]);
  });

  it("ignores subagent and non-assistant messages", () => {
    const toolUse = { content: [{ type: "tool_use", name: "Bash", input: {} }] };
    expect(toolAttemptsInMessage({ type: "assistant", parent_tool_use_id: "toolu_1", message: toolUse })).toEqual([]);
    expect(toolAttemptsInMessage({ type: "user", message: toolUse })).toEqual([]);
    expect(scenarioToolName("mcp__plugin_muggle_muggle__x")).toBe("mcp__plugin_muggle_muggle__x");
  });

  it("names a tool as the session calls it, the inverse of the scenario name", () => {
    for (const sessionName of ["Read", "Bash", "mcp__eval_host__Skill", "mcp__eval_host__Monitor", "mcp__eval_mock__muggle-local-execute-replay"]) {
      expect(sessionToolName(scenarioToolName(sessionName))).toBe(sessionName);
    }
  });
});
