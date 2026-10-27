import { describe, it, expect, beforeEach, vi } from "vitest";
import { spawn } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { hostname, tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import type { GuardrailState } from "../../guardrails/types.js";
import type { HookGroup, HooksManifest } from "./footprint/types.js";
import { MUGGLE_TELEMETRY_SKILL_EMIT_TOOL } from "./handoff-replay/constants.js";

// A muggle skill emit has one writer, skill-stages, which records the skill,
// its mandatory stages and the muggle-test E2E run in one commit. Every host
// runs a tool's matching hook groups in parallel, and a writer that cannot take
// the session's lock within its wait hands its record to a detached commit;
// losing skill-stages' record would leave the stage and classification gates
// unarmed.

const CLI = fileURLToPath(new URL("../../guardrails/cli.ts", import.meta.url));
const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugin", import.meta.url));
const CLAUDE_HOOKS = join(PLUGIN_ROOT, "hooks", "hooks.json");
const CODEX_HOOKS = join(PLUGIN_ROOT, "hooks", "codex-hooks.json");
const CODEX_SKILL_EMIT_TOOL = "mcp__muggle__muggle_local_telemetry_skill_emit";
const CODEX_EXECUTE_REPLAY_TOOL = "mcp__muggle__muggle_local_execute_replay";
const GUARDRAIL_SCRIPT = /guardrail-[a-z-]+\.sh/g;
// A matcher made only of names and `|` lists tools compared whole; any other is an unanchored regex.
const NAME_LIST_MATCHER = /^[A-Za-z0-9_|]+$/;
const ROUNDS = 12;
// Covers the detached commit's own cold start, which a loaded Windows box stretches to seconds.
const DEFERRED_COMMIT_TIMEOUT_MS = 30_000;

interface HookOutcome {
  exitCode: number | null;
  stderr: string;
}

function runHook(subcommand: string, home: string, payload: unknown): Promise<HookOutcome> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI, subcommand], {
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, MUGGLE_HOOK_HOST: "codex" },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.stdin.end(JSON.stringify(payload));
    child.on("close", (exitCode) => resolve({ exitCode: exitCode, stderr: stderr }));
  });
}

const skillEmitPayload = (sessionId: string) => ({
  session_id: sessionId,
  hook_event_name: "PostToolUse",
  tool_name: CODEX_SKILL_EMIT_TOOL,
  tool_input: { skillName: "muggle-test" },
  tool_response: [{ type: "text", text: '{"ok":true}' }],
});

const executeReplayPayload = (sessionId: string) => ({
  session_id: sessionId,
  hook_event_name: "PostToolUse",
  tool_name: CODEX_EXECUTE_REPLAY_TOOL,
  tool_input: { testScriptId: "ts-1" },
  tool_response: [{ type: "text", text: "Replay PASSED" }],
});

const statePath = (home: string, sessionId: string): string => join(home, ".muggle-ai", "guardrails", `${sessionId}.json`);

function stateOf(home: string, sessionId: string): GuardrailState | undefined {
  const file = statePath(home, sessionId);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as GuardrailState) : undefined;
}

function groupMatchesTool(group: HookGroup, toolName: string): boolean {
  if (!group.matcher) return true;
  return NAME_LIST_MATCHER.test(group.matcher)
    ? group.matcher.split("|").includes(toolName)
    : new RegExp(group.matcher).test(toolName);
}

/** The guardrail scripts a manifest's PostToolUse groups run for `toolName`, one entry per group naming each. */
function postToolUseScriptsFor(manifestPath: string, toolName: string): string[][] {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as HooksManifest;
  return (manifest.hooks.PostToolUse ?? [])
    .filter((group) => groupMatchesTool(group, toolName))
    .map((group) => group.hooks.flatMap((hook) => hook.command.match(GUARDRAIL_SCRIPT) ?? []));
}

describe("the hook a skill emit reaches", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "gr-skill-emit-"));
  });

  it.each([
    ["Claude Code", CLAUDE_HOOKS, MUGGLE_TELEMETRY_SKILL_EMIT_TOOL],
    ["Codex", CODEX_HOOKS, CODEX_SKILL_EMIT_TOOL],
  ])("is skill-stages alone, in one PostToolUse group of the %s manifest", (_host, manifestPath, toolName) => {
    expect(postToolUseScriptsFor(manifestPath, toolName)).toEqual([["guardrail-skill-stages.sh"]]);
  });

  // Each session's one writer runs alongside every other session's, so a record
  // missing here is a writer that crashed or exited without committing; the
  // failure carries its exit and stderr to tell which.
  it("leaves the skill, its mandatory stages and the E2E run in every session when emits run at once", async () => {
    const sessions = Array.from({ length: ROUNDS }, (_, round) => `emit-${round}`);
    const outcomes = await Promise.all(sessions.map((sessionId) => runHook("skill-stages", home, skillEmitPayload(sessionId))));
    sessions.forEach((sessionId, index) => {
      const state = stateOf(home, sessionId);
      const outcome = outcomes[index];
      const writer = `${sessionId} (skill-stages exit=${outcome.exitCode} stderr=${JSON.stringify(outcome.stderr.trim().slice(0, 400))})`;
      expect(state?.lastInvokedSkillName, writer).toBe("muggle-test");
      expect(state?.mandatoryStages?.length, writer).toBeGreaterThan(0);
      expect(state?.e2eRun, writer).toBe(true);
    });
  });

  // A holder can stay in its few-millisecond section for seconds when the machine
  // is loaded, outlasting the hook's lock wait. Losing the waiter's record there
  // disarms the gate it feeds while both hooks exit clean, so the record must
  // land once the lock frees — and never by writing around a live holder.
  it.each([
    { writer: "skill-stages", payload: skillEmitPayload },
    { writer: "record-tests", payload: executeReplayPayload },
  ])("$writer commits only under the session's lock, and lands its record once the holder lets go", async ({ writer, payload }) => {
    const lock = `${statePath(home, "held")}.lock`;
    mkdirSync(join(home, ".muggle-ai", "guardrails"), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() }));
    try {
      expect((await runHook(writer, home, payload("held"))).exitCode).toBe(0);
      expect(stateOf(home, "held")).toBeUndefined();
    } finally {
      unlinkSync(lock);
    }
    await vi.waitFor(() => expect(stateOf(home, "held")?.e2eRun).toBe(true), { timeout: DEFERRED_COMMIT_TIMEOUT_MS, interval: 100 });
  }, DEFERRED_COMMIT_TIMEOUT_MS * 2);
});
