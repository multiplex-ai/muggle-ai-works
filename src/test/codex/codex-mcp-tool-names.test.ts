import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";
import { fileURLToPath } from "url";
import {
  MUGGLE_EVENT_EMIT_TOOL,
  MUGGLE_EXECUTION_TOOL,
  MUGGLE_FEEDBACK_CREATE_TOOL,
  MUGGLE_SKILL_EMIT_TOOL,
} from "../../guardrails/constants.js";

// Codex names an MCP tool `mcp__<server>__<tool>` with every character outside
// [A-Za-z0-9_] turned into `_` — to the model and to hooks alike — so the
// server's `muggle-local-execute-replay` reaches a hook as
// `mcp__muggle__muggle_local_execute_replay`. A matcher, pre-filter or check
// spelled with the server's hyphens therefore never fires under Codex: every
// muggle MCP hook was dead there until this was pinned against the tools the
// server actually advertises.
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const TOOL_SURFACE_SNAPSHOT = join(REPO_ROOT, "packages", "mcps", "src", "test", "__snapshots__", "mcp-tool-surface.test.ts.snap");
const CLAUDE_HOOKS = join(REPO_ROOT, "plugin", "hooks", "hooks.json");
const CODEX_HOOKS = join(REPO_ROOT, "plugin", "hooks", "codex-hooks.json");
const PLUGIN_ROOT = join(REPO_ROOT, "plugin");
const SCRIPTS = join(PLUGIN_ROOT, "scripts");

// How each host spells a muggle tool to its hooks.
const CLAUDE_CODE_TOOL_PREFIX = "mcp__plugin_muggleai_muggle__";
const CODEX_TOOL_PREFIX = "mcp__muggle__";

const claudeCodeToolName = (serverName: string): string => `${CLAUDE_CODE_TOOL_PREFIX}${serverName}`;
const codexToolName = (serverName: string): string =>
  `${CODEX_TOOL_PREFIX}${serverName.replace(/[^A-Za-z0-9_]/g, "_")}`;

/** Every tool the server advertises, from the snapshot that pins its surface. */
const serverToolNames = [
  ...new Set([...readFileSync(TOOL_SURFACE_SNAPSHOT, "utf-8").matchAll(/"name": "(muggle-[a-z0-9-]+)"/g)].map(([, name]) => name)),
];

type HookGroup = { matcher?: string; hooks: Array<{ command: string }> };
type HooksManifest = { hooks: Record<string, HookGroup[]> };

/** MCP hook groups keyed by event and the script they run, so a Claude Code group and its Codex form line up. */
function mcpMatchersByHook(manifestPath: string): Map<string, string> {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as HooksManifest;
  const matchers = new Map<string, string>();
  for (const [event, groups] of Object.entries(manifest.hooks)) {
    for (const group of groups) {
      if (!group.matcher?.startsWith("mcp__")) continue;
      for (const hook of group.hooks) {
        matchers.set(`${event} ${hook.command.slice(hook.command.indexOf("bash "))}`, group.matcher);
      }
    }
  }
  return matchers;
}

const selectedTools = (pattern: RegExp, spell: (serverName: string) => string): string[] =>
  serverToolNames.filter((name) => pattern.test(spell(name)));

describe("muggle MCP tool names under Codex", () => {
  it("reads the advertised tool surface", () => {
    expect(serverToolNames.length).toBeGreaterThanOrEqual(100);
    expect(serverToolNames).toContain("muggle-local-execute-replay");
  });

  it("gives every MCP hook a Codex matcher that selects exactly the tools its Claude Code matcher does", () => {
    const claudeMatchers = mcpMatchersByHook(CLAUDE_HOOKS);
    const codexMatchers = mcpMatchersByHook(CODEX_HOOKS);
    expect([...codexMatchers.keys()].sort()).toEqual([...claudeMatchers.keys()].sort());
    for (const [hook, claudeMatcher] of claudeMatchers) {
      const claudeSelection = selectedTools(new RegExp(claudeMatcher), claudeCodeToolName);
      const codexSelection = selectedTools(new RegExp(codexMatchers.get(hook)!), codexToolName);
      expect(claudeSelection.length, hook).toBeGreaterThan(0);
      expect(codexSelection, hook).toEqual(claudeSelection);
    }
  });

  it.each([
    ["MUGGLE_EXECUTION_TOOL", MUGGLE_EXECUTION_TOOL],
    ["MUGGLE_SKILL_EMIT_TOOL", MUGGLE_SKILL_EMIT_TOOL],
    ["MUGGLE_EVENT_EMIT_TOOL", MUGGLE_EVENT_EMIT_TOOL],
    ["MUGGLE_FEEDBACK_CREATE_TOOL", MUGGLE_FEEDBACK_CREATE_TOOL],
  ])("%s recognizes the same tools in either host's spelling", (_label, pattern) => {
    const claudeSelection = selectedTools(pattern, claudeCodeToolName);
    expect(claudeSelection.length).toBeGreaterThan(0);
    expect(selectedTools(pattern, codexToolName)).toEqual(claudeSelection);
  });
});

// The wrappers decide in-shell whether Node runs at all, so a pre-filter that
// misses Codex's spelling silences its gate as surely as a dead matcher. These
// run the real wrappers with `node` stubbed on PATH: the marker proves Node ran.
describe.skipIf(process.platform === "win32")("guardrail pre-filters for a Codex MCP payload", () => {
  const NODE_RAN = "__STUB_NODE_RAN__";
  let binDir: string;

  beforeAll(() => {
    binDir = mkdtempSync(join(tmpdir(), "codex-names-stub-"));
    const stub = join(binDir, "node");
    writeFileSync(stub, `#!/usr/bin/env bash\nprintf '%s' '${NODE_RAN}'\n`);
    chmodSync(stub, 0o755);
  });

  function wrapperRanNode(script: string, toolName: string, toolInput: Record<string, unknown> = {}): boolean {
    const run = spawnSync("bash", [join(SCRIPTS, script)], {
      input: JSON.stringify({ session_id: "codex-names", tool_name: toolName, tool_input: toolInput, tool_response: {} }),
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
        CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT,
        HOME: mkdtempSync(join(tmpdir(), "codex-names-home-")),
      },
    });
    return (run.stdout ?? "").includes(NODE_RAN);
  }

  it("classify-gate: wakes for a Codex execution call, and only for one", () => {
    expect(wrapperRanNode("guardrail-classify-gate.sh", codexToolName("muggle-local-execute-replay"))).toBe(true);
    expect(wrapperRanNode("guardrail-classify-gate.sh", codexToolName("muggle-local-execute-test-generation"))).toBe(true);
    expect(wrapperRanNode("guardrail-classify-gate.sh", codexToolName("muggle-local-check-status"))).toBe(false);
  });

  it("record-stage-signals: wakes for a Codex telemetry emit or feedback submission", () => {
    expect(wrapperRanNode("guardrail-record-stage-signals.sh", codexToolName("muggle-local-telemetry-event-emit"))).toBe(true);
    expect(wrapperRanNode("guardrail-record-stage-signals.sh", codexToolName("muggle-remote-user-feedback-create"))).toBe(true);
    expect(wrapperRanNode("guardrail-record-stage-signals.sh", codexToolName("muggle-local-check-status"))).toBe(false);
  });

  // A skill emit has one writer, skill-stages, so record-tests stays asleep for it.
  it("record-tests: wakes for a Codex execution result, not a Codex skill emit", () => {
    expect(wrapperRanNode("guardrail-record-tests.sh", codexToolName("muggle-local-execute-replay"))).toBe(true);
    expect(
      wrapperRanNode("guardrail-record-tests.sh", codexToolName("muggle-local-telemetry-skill-emit"), { skillName: "muggle-test" }),
    ).toBe(false);
  });

  it("skill-stages: wakes for a Codex skill emit naming a shipped skill", () => {
    expect(
      wrapperRanNode("guardrail-skill-stages.sh", codexToolName("muggle-local-telemetry-skill-emit"), { skillName: "muggle-test" }),
    ).toBe(true);
  });
});
