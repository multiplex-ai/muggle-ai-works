import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CODEX_BIN,
  CodexSession,
  FAKE_PR_URL,
  PLUGIN_ID,
  REPO_ROOT,
  hookOutcomes,
} from "./support/codexSession.js";
import {
  MockResponsesServer,
  assistantMessage,
  hookPrompts,
  messageTexts,
  muggleToolCall,
  shellCall,
  toolCallOutput,
} from "./support/mockResponsesServer.js";
import { ALIASES, CANONICAL_SKILLS, SKILL_NAMES, skillDescription } from "./support/skills.js";
import type { CodexExecResult, ModelRequest, ModelTool } from "./support/types.js";

// The plugin under the real Codex CLI, end to end: installed from this
// checkout with Codex's own `plugin` commands, its MCP server started by the
// plugin's own command, its hooks fired by Codex itself — against a scripted
// model, so every turn is deterministic and needs no credentials. Codex never
// tells the model, or a `--json` reader, that a hook failed; it just lets the
// call through. So beyond what each turn should do, every run is held to "no
// hook failed".
//
// Needs CODEX_BIN (a Codex binary or the npm package's bin/codex.js) and a
// build (`pnpm run build`); without CODEX_BIN it skips. The codex-compat CI
// job sets both, plus MUGGLE_REQUIRE_CODEX_LIVE so a missing binary fails.

// Read from the manifest Codex runs, so a hook added or retired there moves the expectation with it.
const SESSION_START_HOOK_COUNT = (
  JSON.parse(readFileSync(join(REPO_ROOT, "plugin", "hooks", "codex-hooks.json"), "utf-8")) as {
    hooks: { SessionStart: { hooks: unknown[] }[] };
  }
).hooks.SessionStart.flatMap((group) => group.hooks).length;

const ADVERTISED_TOOLS = [
  ...new Set(
    [
      ...readFileSync(
        join(REPO_ROOT, "packages", "mcps", "src", "test", "__snapshots__", "mcp-tool-surface.test.ts.snap"),
        "utf-8",
      ).matchAll(/"name": "(muggle-[a-z0-9-]+)"/g),
    ].map(([, name]) => name),
  ),
];
const CODEX_HOOKS = JSON.parse(readFileSync(join(REPO_ROOT, "plugin", "hooks", "codex-hooks.json"), "utf-8")) as {
  hooks: Record<string, Array<{ matcher?: string; hooks: unknown[] }>>;
};
const WINDOWS = process.platform === "win32";
const LIVE_TIMEOUT_MS = 180_000;

function noHookFailed(run: CodexExecResult): void {
  expect(hookOutcomes(run.stderr).filter((outcome) => outcome.endsWith(" Failed"))).toEqual([]);
}

const muggleNamespace = (request: ModelRequest): ModelTool | undefined =>
  request.tools?.find((tool) => tool.type === "namespace" && tool.name === "mcp__muggle");

it.runIf(process.env.MUGGLE_REQUIRE_CODEX_LIVE === "1")("has a Codex CLI to run the live suite against", () => {
  expect(CODEX_BIN, "set CODEX_BIN to the Codex CLI under test").toBeTruthy();
});

describe.skipIf(!CODEX_BIN)("the muggle plugin in a real Codex", () => {
  const model = new MockResponsesServer();
  const session = new CodexSession(model);
  let skills: { skills: Array<{ name: string; pluginId?: string; interface: { displayName?: string } | null }>; errors: unknown[] };
  let hooks: {
    hooks: Array<{ eventName: string; command: string; pluginId?: string; trustStatus: string }>;
    warnings: unknown[];
    errors: unknown[];
  };
  let mcp: { name: string; pluginId?: string; tools: Record<string, unknown>; toolsError: unknown };
  let appServerLog: string;
  // The installed plugin root exactly as Codex hands it to the hooks — read off
  // the commands it substituted it into, since a temp dir can be spelled
  // differently on the way (an 8.3 name on Windows, /private on macOS).
  let pluginRoot: string;

  beforeAll(async () => {
    await model.start();
    session.prepare();
    const appServer = await session.appServer([
      { method: "skills/list", params: { cwds: [session.workspace], forceReload: true } },
      { method: "hooks/list", params: { cwds: [session.workspace] } },
      { method: "mcpServerStatus/list", params: { serverName: "muggle", detail: "toolsAndAuthOnly" } },
    ]);
    const [skillsList, hooksList, mcpStatus] = appServer.responses;
    appServerLog = appServer.log;
    skills = (skillsList.result as { data: Array<typeof skills> }).data[0];
    hooks = (hooksList.result as { data: Array<typeof hooks> }).data[0];
    mcp = (mcpStatus.result as { data: Array<typeof mcp> }).data.find((server) => server.name === "muggle")!;
    const sessionStart = hooks.hooks.find((hook) => hook.command.includes("ensure-electron-app.sh"))!;
    pluginRoot = /"([^"]+)[\\/]scripts[\\/]ensure-electron-app\.sh"/.exec(sessionStart.command)![1];
  }, LIVE_TIMEOUT_MS);

  afterAll(async () => {
    await model.stop();
  });

  describe("what Codex loads", () => {

    it("loads every skill without a load error, under the muggle namespace", () => {
      expect(skills.errors).toEqual([]);
      const loaded = skills.skills.filter((skill) => skill.pluginId === PLUGIN_ID).map((skill) => skill.name);
      expect(loaded.sort()).toEqual(SKILL_NAMES.map((name) => `muggle:${name}`).sort());
    });

    // Codex drops a whole agents/openai.yaml over one type error — and with it
    // the policy that hides the alias — so a parsed interface is the proof.
    it("reads every alias's agents/openai.yaml", () => {
      for (const alias of ALIASES) {
        const skill = skills.skills.find((entry) => entry.name === `muggle:${alias}`);
        expect(skill?.interface?.displayName, alias).toBe(alias);
      }
    });

    it("registers every generated hook, none rejected, and runs none until the user trusts them", () => {
      expect(hooks.warnings).toEqual([]);
      expect(hooks.errors).toEqual([]);
      const generated = Object.values(CODEX_HOOKS.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks));
      const registered = hooks.hooks.filter((hook) => hook.pluginId === PLUGIN_ID);
      expect(registered).toHaveLength(generated.length);
      expect(registered.every((hook) => hook.trustStatus === "untrusted")).toBe(true);
    });

    it("starts the MCP server from the plugin's own command and lists every advertised tool", () => {
      expect(mcp.pluginId).toBe(PLUGIN_ID);
      expect(mcp.toolsError, appServerLog.split("\n").slice(-60).join("\n")).toBeNull();
      expect(Object.keys(mcp.tools).sort()).toEqual([...ADVERTISED_TOOLS].sort());
    });
  });

  describe("a turn that names a skill", () => {
    let run: CodexExecResult;
    let firstRequest: ModelRequest;

    beforeAll(async () => {
      run = await session.exec("$muggle:muggle-status check my install", () => assistantMessage("All good."));
      firstRequest = run.requests[0];
    }, LIVE_TIMEOUT_MS);

    it("completes with every hook succeeding", () => {
      expect(run.status, run.stderr).toBe(0);
      noHookFailed(run);
      expect(hookOutcomes(run.stderr).filter((outcome) => outcome === "SessionStart Completed")).toHaveLength(SESSION_START_HOOK_COUNT);
    });

    it("opens with Muggle's session context, worded for Codex", () => {
      const context = messageTexts(firstRequest, "developer").find((text) => text.includes("You have access to Muggle AI"));
      expect(context).toBeDefined();
      expect(context).toContain("Muggle Test is running inside Codex");
      expect(context).toContain(`${pluginRoot}/skills/_shared/host-tool-equivalents.md`);
      expect(context).toContain("$muggle:muggle-test");
    });

    it("lists every canonical skill to the model with its whole description, and no alias", () => {
      const catalog = messageTexts(firstRequest, "developer").find((text) => text.startsWith("<skills_instructions>"))!;
      expect(catalog).not.toContain("Exceeded skills context budget");
      const listed = [...catalog.matchAll(/^- muggle:([\w-]+):/gm)].map(([, name]) => name);
      expect(listed.sort()).toEqual([...CANONICAL_SKILLS].sort());
      for (const skill of CANONICAL_SKILLS) {
        expect(catalog, skill).toContain(`- muggle:${skill}: ${skillDescription(skill)} (`);
      }
    });

    it("injects the skill the user named", () => {
      const injected = messageTexts(firstRequest, "user").find((text) => text.startsWith("<skill>"));
      expect(injected).toContain("<name>muggle:muggle-status</name>");
      expect(injected).toContain("name: muggle-status");
    });

    it("offers the model every muggle MCP tool, as Codex spells them", () => {
      const offered = muggleNamespace(firstRequest)?.tools?.map((tool) => tool.name) ?? [];
      expect(offered.sort()).toEqual(ADVERTISED_TOOLS.map((name) => name.replace(/[^A-Za-z0-9_]/g, "_")).sort());
    });
  });

  // The guardrails that key on muggle MCP calls, through Codex's own hook
  // dispatch: a skill emit arms the stage gate, an unclassified execution is
  // denied before a browser starts, and reading the stages through the shell
  // lets the turn end. The execution's test case id is no UUID, so even a
  // regressed gate cannot start a real run — the server rejects it.
  describe("guardrails keyed on muggle MCP calls", () => {
    let run: CodexExecResult;
    const stages = ["failure-mode-handling.md", "debug-failed-run.md", "identity-and-inbox.md"];

    beforeAll(async () => {
      const stagePaths = stages.map((file) => `${pluginRoot}/skills/_shared/${file}`);
      const readStages = WINDOWS
        ? `${stagePaths.map((path) => `Get-Content -LiteralPath '${path}' | Out-Null`).join("; ")}; Write-Output read-stages`
        : `cat ${stagePaths.map((path) => `'${path}'`).join(" ")} > /dev/null && echo read-stages`;
      let stagesRead = false;
      run = await session.exec("$muggle:muggle-test run my tests", (request, index) => {
        if (index === 0) return muggleToolCall("emit", "muggle-local-telemetry-skill-emit", { skillName: "muggle-test" });
        if (index === 1) {
          return muggleToolCall("execute", "muggle-local-execute-test-generation", {
            testCase: { id: "tc-1", title: "Sign up" },
            localUrl: "http://localhost:3000",
          });
        }
        if (!stagesRead && hookPrompts(request).some((prompt) => prompt.includes("mandatory stages"))) {
          stagesRead = true;
          return shellCall("read-stages", readStages);
        }
        return assistantMessage("Done.");
      });
    }, LIVE_TIMEOUT_MS);

    it("completes with every hook succeeding", () => {
      expect(run.status, run.stderr).toBe(0);
      noHookFailed(run);
    });

    it("names the skill's mandatory stages the moment the skill emits", () => {
      const afterEmit = messageTexts(run.requests[1], "developer").find((text) => text.includes("declares required reading"));
      for (const stage of stages) expect(afterEmit).toContain(stage);
    });

    it("denies an unclassified browser run before it starts", () => {
      const output = toolCallOutput(run.requests[2], "execute");
      expect(output).toContain("blocked by PreToolUse hook");
      expect(output).toContain("pre-execution classification");
    });

    it("holds the turn end until the stages are read, then lets it end", () => {
      const stopPrompts = hookPrompts(run.requests.at(-1)!);
      expect(stopPrompts).toHaveLength(1);
      expect(stopPrompts[0]).toContain("mandatory stages");
      expect(toolCallOutput(run.requests.at(-1)!, "read-stages")).toContain("read-stages");
    });
  });

  describe("a turn that opens a PR", () => {
    let run: CodexExecResult;

    beforeAll(async () => {
      run = await session.exec("open a PR for my change", (_request, index) =>
        index === 0 ? shellCall("open-pr", "gh pr create --fill") : assistantMessage("Opened it."),
      );
    }, LIVE_TIMEOUT_MS);

    it("completes with every hook succeeding", () => {
      expect(run.status, run.stderr).toBe(0);
      noHookFailed(run);
    });

    it("sees the PR in the shell's bare-string output", () => {
      const notice = messageTexts(run.requests[1], "developer").find((text) => text.includes("A pull request was just opened"));
      expect(notice).toContain(FAKE_PR_URL);
    });

    it("holds the turn for an E2E run, naming skills the way Codex invokes them", () => {
      const prompts = hookPrompts(run.requests.at(-1)!);
      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts[0]).toContain("$muggle:muggle-test");
      expect(prompts.join("\n")).not.toMatch(/\/muggle:/);
    });
  });

  describe("a turn that asks for a build", () => {
    let run: CodexExecResult;

    beforeAll(async () => {
      run = await session.exec("implement dark mode for the settings page", () => assistantMessage("On it."));
    }, LIVE_TIMEOUT_MS);

    it("routes it toward muggle-do, by its Codex name", () => {
      expect(run.status, run.stderr).toBe(0);
      noHookFailed(run);
      const advice = messageTexts(run.requests[0], "developer").find((text) => text.includes("build/implement/fix request"));
      expect(advice).toContain("$muggle:muggle-do");
    });
  });
});
