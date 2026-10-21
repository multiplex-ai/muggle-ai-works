import { describe, it, expect, beforeEach } from "vitest";
import { spawn } from "child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { hostname, tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import type { GuardrailState } from "../../guardrails/types.js";

// A muggle skill emit reaches two hooks at once — record-tests and
// skill-stages, separate entries in hooks.json that every host runs in
// parallel — and both write the session's state. Written unlocked, the later
// write erased the earlier about one emit in six, and with it the skill and its
// mandatory stages: the stage gate and the classification gate went unarmed.

const CLI = fileURLToPath(new URL("../../guardrails/cli.ts", import.meta.url));
const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugin", import.meta.url));
const WRITERS = ["record-tests", "skill-stages"];
const ROUNDS = 12;

function runHook(subcommand: string, home: string, payload: unknown): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI, subcommand], {
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT, MUGGLE_HOOK_HOST: "codex" },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.stdin.end(JSON.stringify(payload));
    child.on("close", resolve);
  });
}

const skillEmit = (sessionId: string) => ({
  session_id: sessionId,
  hook_event_name: "PostToolUse",
  tool_name: "mcp__muggle__muggle_local_telemetry_skill_emit",
  tool_input: { skillName: "muggle-test" },
  tool_response: [{ type: "text", text: '{"ok":true}' }],
});

const statePath = (home: string, sessionId: string): string => join(home, ".muggle-ai", "guardrails", `${sessionId}.json`);

function stateOf(home: string, sessionId: string): GuardrailState | undefined {
  const file = statePath(home, sessionId);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf-8")) as GuardrailState) : undefined;
}

describe("the two hooks a skill emit reaches", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "gr-skill-emit-"));
  });

  // Whether a given run interleaves badly is up to the scheduler, so this shows
  // the outcome rather than pinning the race; the lock tests below pin that.
  it("leave the session with both writers' records when they run at once", async () => {
    const sessions = Array.from({ length: ROUNDS }, (_, round) => `emit-${round}`);
    await Promise.all(sessions.flatMap((sessionId) => WRITERS.map((writer) => runHook(writer, home, skillEmit(sessionId)))));
    for (const sessionId of sessions) {
      const state = stateOf(home, sessionId);
      expect(state?.lastInvokedSkillName, sessionId).toBe("muggle-test");
      expect(state?.mandatoryStages?.length, sessionId).toBeGreaterThan(0);
      expect(state?.e2eRun, sessionId).toBe(true);
    }
  });

  it.each(WRITERS)("%s commits only under the session's lock", async (writer) => {
    const lock = `${statePath(home, "held")}.lock`;
    mkdirSync(join(home, ".muggle-ai", "guardrails"), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() }));
    try {
      expect(await runHook(writer, home, skillEmit("held"))).toBe(0);
      expect(stateOf(home, "held")).toBeUndefined();
    } finally {
      unlinkSync(lock);
    }
  });
});
