import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, dirname, join } from "path";
import { MUGGLE_EXECUTION_TOOL, SKILL_NAME_INPUT_KEYS } from "../../guardrails/constants.js";
import { wrapperPayloadPrefilter } from "./support/wrapperPrefilter.js";

// The three stage guardrails only ever fire through a bash wrapper, so the
// wrapper's pre-filter — not the TypeScript — decides whether they exist at all.
// A filter that under-matches turns the whole gate into dead code while the
// instruction text keeps telling users to run a marker that can never register.
const SCRIPTS = fileURLToPath(new URL("../../../plugin/scripts", import.meta.url));
const HOOKS = fileURLToPath(new URL("../../../plugin/hooks/hooks.json", import.meta.url));
const GUARDRAIL_SOURCE = fileURLToPath(new URL("../../guardrails", import.meta.url));

// src/guardrails/ groups related units into purpose folders, so a scan that
// only reads top-level entries goes blind to anything nested — and a skip
// marker the gates advertise but the scan cannot see is the dead-escape-hatch
// bug these assertions exist to catch.
function guardrailSourceFiles(dir: string = GUARDRAIL_SOURCE): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? guardrailSourceFiles(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}

const CLI = fileURLToPath(new URL("../../guardrails/cli.ts", import.meta.url));

function wrapperBody(wrapperScriptName: string): string {
  return readFileSync(join(SCRIPTS, wrapperScriptName), "utf-8");
}

const readPayload = (filePath: string): string =>
  JSON.stringify({ tool_name: "Read", tool_input: { file_path: filePath } });

const commandPayload = (command: string): string =>
  JSON.stringify({ tool_name: "Bash", tool_input: { command: command } });

describe("stage-read pre-filter reaches every path a mandatory stage can live at", () => {
  const prefilter = wrapperPayloadPrefilter("guardrail-record-stage-read.sh");

  it.each([
    ["a shared stage read on posix", readPayload("/home/u/.claude/plugins/muggle/skills/_shared/debug-failed-run.md")],
    [
      "a shared stage read on windows",
      readPayload("C:\\Users\\u\\.claude\\plugins\\muggle\\skills\\_shared\\debug-failed-run.md"),
    ],
    ["a stage that lives inside the skill dir", readPayload("/p/skills/muggle-test/execute-local.md")],
    ["the skill entry point itself", readPayload("/p/skills/muggle-test/SKILL.md")],
  ])("spawns Node for %s", (_label, payload) => {
    expect(prefilter.test(payload)).toBe(true);
  });

  it("short-circuits a read outside any skills tree", () => {
    expect(prefilter.test(readPayload("/repo/src/index.ts"))).toBe(false);
    expect(prefilter.test(readPayload("/repo/README.md"))).toBe(false);
  });

  // A Read's payload carries the file it returned, and a repo doc routinely names stage files.
  it("short-circuits a read outside any skills tree whose contents name a stage file", () => {
    const payload = JSON.stringify({
      tool_name: "Read",
      tool_input: { file_path: "/repo/README.md" },
      tool_response: { type: "text", file: { content: "See plugin/skills/muggle-do/SKILL.md and skills/_shared/debug-failed-run.md" } },
    });
    expect(prefilter.test(payload)).toBe(false);
  });

  // A host with no Read tool (Codex) opens stages through the shell.
  it.each([
    ["a quoted absolute path", commandPayload('cat "/home/u/.codex/plugins/cache/muggle-works/muggle/5.18.0/skills/_shared/debug-failed-run.md"')],
    ["a path through the plugin-root variable", commandPayload('sed -n \'1,200p\' "${CLAUDE_PLUGIN_ROOT}/skills/muggle-test/execute-local.md"')],
    ["a path relative to a cd into the skills tree", commandPayload("cd /p/skills && cat _shared/debug-failed-run.md")],
    [
      "a path relative to the payload's cwd",
      JSON.stringify({ cwd: "/p/skills/muggle-test", tool_name: "Bash", tool_input: { command: "cat ../_shared/debug-failed-run.md" } }),
    ],
  ])("spawns Node for a shell read with %s", (_label, payload) => {
    expect(prefilter.test(payload)).toBe(true);
  });

  it("short-circuits a shell command with no skills-tree markdown in it", () => {
    expect(prefilter.test(commandPayload("cat README.md"))).toBe(false);
    expect(prefilter.test(commandPayload("ls"))).toBe(false);
  });
});

describe("stage-signal pre-filter reaches every payload the recorder acts on", () => {
  const prefilter = wrapperPayloadPrefilter("guardrail-record-stage-signals.sh");

  it.each([
    [
      "a pre-execution classification emit",
      JSON.stringify({
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-event-emit",
        tool_input: { eventType: "pre-execution-classification", testCaseId: "tc-1" },
      }),
    ],
    [
      "feedback submitted against a failed run",
      JSON.stringify({
        tool_name: "mcp__plugin_muggle_muggle__muggle-remote-user-feedback-create",
        tool_input: { runId: "run-1" },
      }),
    ],
  ])("spawns Node for %s", (_label, payload) => {
    expect(prefilter.test(payload)).toBe(true);
  });

  // Derived from source, never hand-listed: a marker the block text tells the
  // user to run must reach the recorder the moment the gate defines it.
  it("spawns Node for every skip marker the guardrails define", () => {
    const markerTokens = new Set(
      guardrailSourceFiles().flatMap(
        (path) => readFileSync(path, "utf-8").match(/MUGGLE_[A-Z0-9_]+_SKIP/g) ?? [],
      ),
    );
    expect(markerTokens.size).toBeGreaterThanOrEqual(6);
    for (const token of markerTokens) {
      expect(prefilter.test(commandPayload(`echo "${token}: reason"`)), token).toBe(true);
    }
  });

  it("short-circuits an unrelated command", () => {
    expect(prefilter.test(commandPayload("git status"))).toBe(false);
  });
});

// Both gates stand in front of exactly the tools that burn a browser run, so
// each pre-filter must name the same pair the decision does — a filter that
// drifts from the matcher acts on nothing while the gate still claims to.
describe.each(["guardrail-classify-gate.sh", "guardrail-walkthrough-rerun.sh", "guardrail-walkthrough-progress.sh"])(
  "%s pre-filter names the same execution tools the gate acts on",
  (wrapperScriptName) => {
    const prefilter = wrapperPayloadPrefilter(wrapperScriptName);

    it.each([
      "mcp__plugin_muggle_muggle__muggle-local-execute-test-generation",
      "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
    ])("spawns Node for %s", (toolName) => {
      expect(MUGGLE_EXECUTION_TOOL.test(toolName)).toBe(true);
      expect(prefilter.test(JSON.stringify({ tool_name: toolName }))).toBe(true);
    });

    it("short-circuits a read-only muggle tool", () => {
      expect(
        prefilter.test(JSON.stringify({ tool_name: "mcp__plugin_muggle_muggle__muggle-local-run-result-get" })),
      ).toBe(false);
    });
  },
);

describe("skill-stages pre-filter reads the same input keys the resolver does", () => {
  const body = wrapperBody("guardrail-skill-stages.sh");

  it.each(SKILL_NAME_INPUT_KEYS)("accepts the %s input key", (inputKey) => {
    expect(body).toContain(inputKey);
  });

  it("keys the short-circuit on a skill this plugin actually ships", () => {
    expect(body).toContain("SKILL.md");
  });
});

// The Stop gates pre-filter on the per-session state file rather than a payload,
// which couples them to the exact JSON sessionState writes. Running the real
// grep against a real serialized state is what proves the coupling holds.
describe("stop-gate state pre-filters match the state the recorders write", () => {
  const armedState = JSON.stringify(
    {
      sessionId: "s",
      prsHandled: [],
      mandatoryStages: ["/p/skills/_shared/debug-failed-run.md"],
      stagesRead: [],
      failedRuns: ["run-1"],
      debuggedRuns: [],
    },
    null,
    2,
  );
  const idleState = JSON.stringify(
    { sessionId: "s", prsHandled: [], mandatoryStages: [], failedRuns: [] },
    null,
    2,
  );
  const skippedState = JSON.stringify(
    { sessionId: "s", prsHandled: [], stageSkipped: true, debugSkipped: true },
    null,
    2,
  );
  // A gate that has spent its block budget stamps its release, which is what
  // lets the wrapper fall through in shell instead of cold-starting Node on
  // every remaining turn end.
  const releasedState = JSON.stringify(
    { sessionId: "s", prsHandled: [], stageReleased: true, debugReleased: true },
    null,
    2,
  );

  it.each(["guardrail-stage-gate.sh", "guardrail-debug-path-gate.sh"])(
    "%s greps only for shapes the state file can hold",
    (wrapperScriptName) => {
      const patterns = [...wrapperBody(wrapperScriptName).matchAll(/guardrail_state_has '([^']+)'/g)];
      expect(patterns.length).toBeGreaterThan(0);
      for (const [, statePattern] of patterns) {
        const literal = statePattern.replaceAll("\\[", "[").replaceAll("\\]", "]");
        expect(
          `${armedState}\n${idleState}\n${skippedState}\n${releasedState}`,
          `${wrapperScriptName} greps for ${literal}`,
        ).toContain(literal);
      }
    },
  );
});

describe("hooks.json registers every stage guardrail", () => {
  type HookGroup = { matcher?: string; hooks: Array<{ command: string }> };
  const hooks = (JSON.parse(readFileSync(HOOKS, "utf-8")) as { hooks: Record<string, HookGroup[]> })
    .hooks;
  // Resolves the group the way the harness does — the matcher is a regex over
  // the tool name, so a group covering several tools still answers for each.
  const commandsFor = (event: string, toolName: string): string[] =>
    hooks[event]
      ?.find(
        (group) =>
          group.matcher !== undefined && new RegExp(`^(?:${group.matcher})$`).test(toolName),
      )
      ?.hooks.map((h) => h.command) ?? [];

  it("observes skill invocations and stage reads", () => {
    expect(commandsFor("PostToolUse", "Skill").join()).toContain("guardrail-skill-stages.sh");
    expect(commandsFor("PostToolUse", "Read").join()).toContain("guardrail-record-stage-read.sh");
  });

  // The Skill tool is the primary signal, but its payload shape is the host's
  // to change. A muggle skill announces itself over MCP on its first step, so
  // the declaration still lands if the Skill hook ever stops carrying a name.
  it("also observes the skill's own telemetry announcement", () => {
    const announced = hooks.PostToolUse.find(
      (group) =>
        group.matcher?.startsWith("mcp__") &&
        group.hooks.some((h) => h.command.includes("guardrail-skill-stages.sh")),
    );
    expect(announced).toBeDefined();
    expect(
      new RegExp(announced!.matcher!).test(
        "mcp__plugin_muggle_muggle__muggle-local-telemetry-skill-emit",
      ),
    ).toBe(true);
  });

  it("observes the classification and debug-path signals", () => {
    const signalMatcher = hooks.PostToolUse.find((group) =>
      group.hooks.some((h) => h.command.includes("guardrail-record-stage-signals.sh")) &&
      group.matcher?.startsWith("mcp__"),
    );
    expect(signalMatcher).toBeDefined();
    const matcher = new RegExp(signalMatcher!.matcher!);
    expect(matcher.test("mcp__plugin_muggle_muggle__muggle-local-telemetry-event-emit")).toBe(true);
    expect(matcher.test("mcp__plugin_muggle_muggle__muggle-remote-user-feedback-create")).toBe(true);
  });

  it("records stage reads made through the shell as well as the Read tool", () => {
    expect(commandsFor("PostToolUse", "Bash").join()).toContain("guardrail-record-stage-read.sh");
  });

  it("records skip markers typed in either shell", () => {
    expect(commandsFor("PostToolUse", "Bash").join()).toContain("guardrail-record-stage-signals.sh");
    expect(commandsFor("PostToolUse", "PowerShell").join()).toContain(
      "guardrail-record-stage-signals.sh",
    );
  });

  it("gates both local execution tools before they burn a browser run", () => {
    const gate = hooks.PreToolUse.find((group) =>
      group.hooks.some((h) => h.command.includes("guardrail-classify-gate.sh")),
    );
    expect(gate).toBeDefined();
    const matcher = new RegExp(gate!.matcher!);
    expect(matcher.test("mcp__plugin_muggle_muggle__muggle-local-execute-test-generation")).toBe(true);
    expect(matcher.test("mcp__plugin_muggle_muggle__muggle-local-execute-replay")).toBe(true);
    expect(matcher.test("mcp__plugin_muggle_muggle__muggle-local-run-result-get")).toBe(false);
  });

  it("marks the PR's walkthrough as rerunning from the same execution hook", () => {
    const gate = hooks.PreToolUse.find((group) =>
      group.hooks.some((h) => h.command.includes("guardrail-classify-gate.sh")),
    );
    expect(gate!.hooks.some((h) => h.command.includes("guardrail-walkthrough-rerun.sh"))).toBe(true);
  });

  it("fills each finished case into the PR's progress table after both local execution tools", () => {
    const recorder = hooks.PostToolUse.find((group) =>
      group.hooks.some((h) => h.command.includes("guardrail-walkthrough-progress.sh")),
    );
    expect(recorder).toBeDefined();
    const matcher = new RegExp(recorder!.matcher!);
    expect(matcher.test("mcp__plugin_muggle_muggle__muggle-local-execute-test-generation")).toBe(true);
    expect(matcher.test("mcp__plugin_muggle_muggle__muggle-local-execute-replay")).toBe(true);
  });

  it("runs both new Stop gates", () => {
    const stop = hooks.Stop[0].hooks.map((h) => h.command).join();
    expect(stop).toContain("guardrail-stage-gate.sh");
    expect(stop).toContain("guardrail-debug-path-gate.sh");
  });
});

describe("stage guardrail cli entry", () => {
  let home: string;
  let pluginRoot: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "gr-stage-home-"));
    pluginRoot = mkdtempSync(join(tmpdir(), "gr-stage-plugin-"));
    mkdirSync(join(pluginRoot, "skills", "demo-skill"), { recursive: true });
    mkdirSync(join(pluginRoot, "skills", "_shared"), { recursive: true });
    writeFileSync(join(pluginRoot, "skills", "_shared", "debug-failed-run.md"), "# debug");
    writeFileSync(
      join(pluginRoot, "skills", "demo-skill", "SKILL.md"),
      ["---", "name: demo-skill", "mandatoryStages:", "  - ../_shared/debug-failed-run.md", "---"].join("\n"),
    );
  });

  function runHook(sub: string, stdin: unknown): { status: number | null; out: string } {
    const r = spawnSync(process.execPath, ["--import", "tsx", CLI, sub], {
      input: JSON.stringify(stdin),
      encoding: "utf-8",
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        CURSOR_PLUGIN_ROOT: "",
      },
    });
    return { status: r.status, out: (r.stdout ?? "").trim() };
  }

  it("skill-stages: names the required reading when a skill declares stages", () => {
    const { status, out } = runHook("skill-stages", {
      session_id: "stages",
      tool_name: "Skill",
      tool_input: { skill: "demo-skill" },
    });
    expect(status).toBe(0);
    const parsed = JSON.parse(out);
    expect(parsed.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(parsed.hookSpecificOutput.additionalContext).toContain("_shared/debug-failed-run.md");
  });

  it("skill-stages: stays silent for a skill that declares none", () => {
    writeFileSync(join(pluginRoot, "skills", "demo-skill", "SKILL.md"), "---\nname: demo-skill\n---");
    expect(runHook("skill-stages", { session_id: "none", tool_name: "Skill", tool_input: { skill: "demo-skill" } }).out).toBe("{}");
  });

  it("stage-gate: blocks the turn end while a declared stage is unread, then clears once read", () => {
    runHook("skill-stages", { session_id: "gate", tool_name: "Skill", tool_input: { skill: "demo-skill" } });
    const blocked = JSON.parse(runHook("stage-gate", { session_id: "gate" }).out);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("_shared/debug-failed-run.md");
    expect(blocked.reason).toContain("MUGGLE_STAGE_SKIP");

    runHook("record-stage-read", {
      session_id: "gate",
      tool_name: "Read",
      tool_input: { file_path: join(pluginRoot, "skills", "_shared", "debug-failed-run.md") },
    });
    expect(runHook("stage-gate", { session_id: "gate" }).out).toBe("{}");
  });

  it("stage-gate: a stage printed through the shell counts as read", () => {
    runHook("skill-stages", { session_id: "shell", tool_name: "Skill", tool_input: { skill: "demo-skill" } });
    expect(JSON.parse(runHook("stage-gate", { session_id: "shell" }).out).decision).toBe("block");

    runHook("record-stage-read", {
      session_id: "shell",
      cwd: join(pluginRoot, "skills", "demo-skill"),
      tool_name: "Bash",
      tool_input: { command: "sed -n '1,200p' ../_shared/debug-failed-run.md" },
      tool_response: "# debug",
    });
    expect(runHook("stage-gate", { session_id: "shell" }).out).toBe("{}");
  });

  it("record-stage-read: a Read outside the skills tree records nothing", () => {
    runHook("skill-stages", { session_id: "outside", tool_name: "Skill", tool_input: { skill: "demo-skill" } });
    runHook("record-stage-read", {
      session_id: "outside",
      tool_name: "Read",
      tool_input: { file_path: "/repo/notes.md" },
      tool_response: { content: "see skills/_shared/debug-failed-run.md" },
    });
    expect(JSON.parse(runHook("stage-gate", { session_id: "outside" }).out).decision).toBe("block");
  });

  it("record-stage-read: opening a route's entry file during a skill's run owes the stages it declares", () => {
    mkdirSync(join(pluginRoot, "skills", "do"), { recursive: true });
    const buildStage = join(pluginRoot, "skills", "do", "build.md");
    const routeEntry = join(pluginRoot, "skills", "do", "pre-flight.md");
    writeFileSync(buildStage, "# build");
    writeFileSync(routeEntry, ["---", "mandatoryStages:", "  - build.md", "---", "# Pre-flight"].join("\n"));
    writeFileSync(join(pluginRoot, "skills", "demo-skill", "SKILL.md"), "---\nname: demo-skill\n---");

    runHook("skill-stages", { session_id: "route", tool_name: "Skill", tool_input: { skill: "demo-skill" } });
    expect(runHook("stage-gate", { session_id: "route" }).out).toBe("{}");

    runHook("record-stage-read", { session_id: "route", tool_name: "Read", tool_input: { file_path: routeEntry } });
    const blocked = JSON.parse(runHook("stage-gate", { session_id: "route" }).out);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("do/build.md");

    runHook("record-stage-read", { session_id: "route", tool_name: "Read", tool_input: { file_path: buildStage } });
    expect(runHook("stage-gate", { session_id: "route" }).out).toBe("{}");
  });

  it("stage-gate: the documented marker releases it", () => {
    runHook("skill-stages", { session_id: "skip", tool_name: "Skill", tool_input: { skill: "demo-skill" } });
    runHook("record-stage-signals", {
      session_id: "skip",
      tool_name: "Bash",
      tool_input: { command: 'echo "MUGGLE_STAGE_SKIP: reading is covered by the caller"' },
    });
    expect(runHook("stage-gate", { session_id: "skip" }).out).toBe("{}");
  });

  // It only queues the banner; a run must never be held up by it.
  it("walkthrough-rerun-notice: never decides on the execution it observes", () => {
    const { status, out } = runHook("walkthrough-rerun-notice", {
      session_id: "rerun",
      tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
      tool_input: { cwd: home },
    });
    expect(status).toBe(0);
    expect(out).toBe("{}");
  });

  it("walkthrough-progress-update: never decides on the execution it observes", () => {
    const { status, out } = runHook("walkthrough-progress-update", {
      session_id: "progress",
      tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
      tool_input: { cwd: home, testScript: { testCaseId: "tc-1", name: "Login" } },
      tool_response: { content: "**Run ID:** run-1\n**Status:** passed" },
    });
    expect(status).toBe(0);
    expect(out).toBe("{}");
  });

  it("classify-gate: denies an unclassified execution, allows it after the classification emit", () => {
    runHook("skill-stages", { session_id: "cls", tool_name: "Skill", tool_input: { skill: "muggle-test" } });
    const denied = JSON.parse(
      runHook("classify-gate", {
        session_id: "cls",
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-test-generation",
        tool_input: { testCase: { id: "tc-1" } },
      }).out,
    );
    expect(denied.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain("6f");
    expect(denied.hookSpecificOutput.permissionDecisionReason).toContain("MUGGLE_CLASSIFY_SKIP");

    runHook("record-stage-signals", {
      session_id: "cls",
      tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-event-emit",
      tool_input: { eventType: "pre-execution-classification", testCaseId: "tc-1" },
    });
    expect(
      runHook("classify-gate", {
        session_id: "cls",
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-test-generation",
        tool_input: { testCase: { id: "tc-1" } },
      }).out,
    ).toBe("{}");
  });

  it("debug-path-gate: blocks a failed run with no debug evidence, clears on the classified emit", () => {
    runHook("record-tests", {
      session_id: "dbg",
      tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
      tool_response: { content: "**Run ID:** run-1\n**Status:** failed" },
    });
    const blocked = JSON.parse(runHook("debug-path-gate", { session_id: "dbg" }).out);
    expect(blocked.decision).toBe("block");
    expect(blocked.reason).toContain("run-1");
    expect(blocked.reason).toContain("MUGGLE_DEBUG_SKIP");

    runHook("record-stage-signals", {
      session_id: "dbg",
      tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-event-emit",
      tool_input: { eventType: "replay-failure-classified", runId: "run-1" },
    });
    expect(runHook("debug-path-gate", { session_id: "dbg" }).out).toBe("{}");
  });

  it("debug-path-gate: a passing run owes nothing", () => {
    runHook("record-tests", {
      session_id: "pass",
      tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
      tool_response: { content: "**Run ID:** run-9\n**Status:** passed" },
    });
    expect(runHook("debug-path-gate", { session_id: "pass" }).out).toBe("{}");
  });
});

// Bash-only, so skipped on win32 (covered by the Linux/macOS platform-compat
// jobs). The static assertions above pin the pre-filter patterns everywhere;
// these prove real grep agrees and that Node stays off the cold path.
describe.skipIf(process.platform === "win32")("stage wrapper pre-filter (no Node on the cold path)", () => {
  const NODE_RAN = "__STUB_NODE_RAN__";
  let stubBinDir: string;
  let pluginRoot: string;

  beforeEach(() => {
    stubBinDir = mkdtempSync(join(tmpdir(), "gr-stage-stub-"));
    const stub = join(stubBinDir, "node");
    writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s' '${NODE_RAN}'\n`);
    chmodSync(stub, 0o755);
    pluginRoot = dirname(SCRIPTS);
  });

  function runWrapper(wrapperScriptName: string, payload: unknown): string {
    const home = mkdtempSync(join(tmpdir(), "gr-stage-wrapper-home-"));
    const r = spawnSync("bash", [join(SCRIPTS, wrapperScriptName)], {
      input: JSON.stringify(payload),
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${stubBinDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_PLUGIN_ROOT: pluginRoot,
        HOME: home,
        USERPROFILE: home,
      },
    });
    return (r.stdout ?? "").trim();
  }

  it("skill-stages: spawns Node only for a skill this plugin ships", () => {
    expect(runWrapper("guardrail-skill-stages.sh", { tool_name: "Skill", tool_input: { skill: "muggle-test" } })).toContain(NODE_RAN);
    expect(runWrapper("guardrail-skill-stages.sh", { tool_name: "Skill", tool_input: { skill: "some-other-plugins-skill" } })).toBe("{}");
    expect(runWrapper("guardrail-skill-stages.sh", { tool_name: "Skill", tool_input: { args: "--flag" } })).toBe("{}");
  });

  it("skill-stages: reaches a namespaced plugin skill invocation", () => {
    expect(runWrapper("guardrail-skill-stages.sh", { tool_name: "Skill", tool_input: { skill: "muggle:muggle-test" } })).toContain(NODE_RAN);
  });

  it("record-stage-read: spawns Node on a skill-tree read, not a source read", () => {
    expect(runWrapper("guardrail-record-stage-read.sh", { tool_name: "Read", tool_input: { file_path: "/p/skills/_shared/debug-failed-run.md" } })).toContain(NODE_RAN);
    expect(runWrapper("guardrail-record-stage-read.sh", { tool_name: "Read", tool_input: { file_path: "/repo/src/index.ts" } })).toBe("{}");
  });

  it("record-stage-read: spawns Node on a shell read of a stage, not on an unrelated command", () => {
    expect(runWrapper("guardrail-record-stage-read.sh", { tool_name: "Bash", tool_input: { command: 'cat "/p/skills/_shared/debug-failed-run.md"' } })).toContain(NODE_RAN);
    expect(runWrapper("guardrail-record-stage-read.sh", { tool_name: "Bash", tool_input: { command: "git status" } })).toBe("{}");
  });

  it("record-stage-read: reads the path fields, not the file a Read returned", () => {
    expect(
      runWrapper("guardrail-record-stage-read.sh", {
        cwd: "/p/skills/muggle-test",
        tool_name: "Bash",
        tool_input: { command: "cat ../_shared/debug-failed-run.md" },
      }),
    ).toContain(NODE_RAN);
    expect(
      runWrapper("guardrail-record-stage-read.sh", {
        tool_name: "Read",
        tool_input: { file_path: "/repo/README.md" },
        tool_response: { type: "text", file: { content: "See skills/_shared/debug-failed-run.md" } },
      }),
    ).toBe("{}");
  });

  it("record-stage-signals: spawns Node on a classification emit and on every skip marker", () => {
    expect(
      runWrapper("guardrail-record-stage-signals.sh", {
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-telemetry-event-emit",
        tool_input: { eventType: "pre-execution-classification", testCaseId: "tc-1" },
      }),
    ).toContain(NODE_RAN);
    for (const token of ["MUGGLE_STAGE_SKIP", "MUGGLE_CLASSIFY_SKIP", "MUGGLE_DEBUG_SKIP"]) {
      expect(
        runWrapper("guardrail-record-stage-signals.sh", {
          tool_name: "Bash",
          tool_input: { command: `echo "${token}: reason"` },
        }),
        token,
      ).toContain(NODE_RAN);
    }
    expect(runWrapper("guardrail-record-stage-signals.sh", { tool_name: "Bash", tool_input: { command: "git status" } })).toBe("{}");
  });

  it("classify-gate: spawns Node on an execution call, not on a read-only muggle tool", () => {
    expect(
      runWrapper("guardrail-classify-gate.sh", {
        session_id: "no-state",
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-execute-replay",
        tool_input: { testScript: { testCaseId: "tc-1" } },
      }),
    ).toContain(NODE_RAN);
    expect(
      runWrapper("guardrail-classify-gate.sh", {
        session_id: "no-state",
        tool_name: "mcp__plugin_muggle_muggle__muggle-local-run-result-get",
        tool_input: { runId: "run-1" },
      }),
    ).toBe("{}");
  });

  it("stage-gate and debug-path-gate: skip Node when nothing is owed", () => {
    expect(runWrapper("guardrail-stage-gate.sh", { session_id: "no-state" })).toBe("{}");
    expect(runWrapper("guardrail-debug-path-gate.sh", { session_id: "no-state" })).toBe("{}");
  });
});
