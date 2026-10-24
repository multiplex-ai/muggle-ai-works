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
    const runs = sessions.flatMap((sessionId) => WRITERS.map((writer) => ({ sessionId: sessionId, writer: writer })));
    const outcomes = await Promise.all(runs.map((run) => runHook(run.writer, home, skillEmit(run.sessionId))));
    // A record goes missing either because its writer crashed or because it exited
    // cleanly without committing. The losing run is rare and only seen on CI, so
    // the failure has to carry both writers' exits and stderr to tell which.
    const describeWriters = (sessionId: string): string =>
      runs
        .map((run, index) => ({ writer: run.writer, sessionId: run.sessionId, outcome: outcomes[index] }))
        .filter((run) => run.sessionId === sessionId)
        .map((run) => `${run.writer} exit=${run.outcome.exitCode} stderr=${JSON.stringify(run.outcome.stderr.trim().slice(0, 400))}`)
        .join("; ");
    for (const sessionId of sessions) {
      const state = stateOf(home, sessionId);
      const writers = `${sessionId} (${describeWriters(sessionId)})`;
      expect(state?.lastInvokedSkillName, writers).toBe("muggle-test");
      expect(state?.mandatoryStages?.length, writers).toBeGreaterThan(0);
      expect(state?.e2eRun, writers).toBe(true);
    }
  });

  it.each(WRITERS)("%s commits only under the session's lock", async (writer) => {
    const lock = `${statePath(home, "held")}.lock`;
    mkdirSync(join(home, ".muggle-ai", "guardrails"), { recursive: true });
    writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() }));
    try {
      expect((await runHook(writer, home, skillEmit("held"))).exitCode).toBe(0);
      expect(stateOf(home, "held")).toBeUndefined();
    } finally {
      unlinkSync(lock);
    }
  });
});
