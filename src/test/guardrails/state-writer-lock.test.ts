import { describe, it, expect } from "vitest";
import { spawn } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { hostname, tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { commitDeferredStateMutations } from "../../guardrails/sessionState.js";
import { applyStateMutation } from "../../guardrails/stateCommit.js";
import type { GuardrailState } from "../../guardrails/types.js";

// Every hook that changes a session's state commits under its lock, so a writer
// that finds the lock held writes nothing and defers its change; the holder's
// own commit then survives the deferred one. Each writer here once did an
// unlocked read-modify-write, which erased whatever a concurrent hook committed
// between its read and its write.

const CLI = fileURLToPath(new URL("../../guardrails/cli.ts", import.meta.url));
const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugin", import.meta.url));
const STAGE_PATH = "/plugin/skills/muggle-do/stage.md";
const HOLDER_COMMIT: Partial<GuardrailState> = { classifiedTestCaseIds: ["holder-commit"] };
// Covers a hook's cold start on a loaded Windows box, twice over for the deferral's lock wait.
const HOOK_TIMEOUT_MS = 60_000;

interface StateWriterCase {
  writer: string;
  payload: Record<string, unknown>;
  seed: Partial<GuardrailState>;
  expectLanded: (state: GuardrailState) => void;
}

const stateWriterCases: StateWriterCase[] = [
  {
    writer: "record-stage-read",
    payload: { tool_name: "Read", tool_input: { file_path: STAGE_PATH }, tool_response: { type: "text" } },
    seed: {},
    expectLanded: (state) => expect(state.stagesRead).toHaveLength(1),
  },
  {
    writer: "record-stage-signals",
    payload: { tool_name: "Bash", tool_input: { command: 'echo "MUGGLE_STAGE_SKIP: no stage applies"' } },
    seed: {},
    expectLanded: (state) => expect(state.stageSkipped).toBe(true),
  },
  {
    writer: "pr-terminal",
    payload: {
      tool_name: "Bash",
      tool_input: { command: "gh pr merge 5" },
      tool_response: { stderr: "✓ Merged pull request o/r#5 (x)\n" },
    },
    seed: {},
    expectLanded: (state) => expect(state.terminalPending).toEqual([5]),
  },
  {
    writer: "offer-ran",
    payload: { tool_name: "AskUserQuestion" },
    seed: { terminalPending: [5] },
    expectLanded: (state) => expect(state).toMatchObject({ terminalPending: [], terminalHandled: [5] }),
  },
  {
    writer: "stage-gate",
    payload: {},
    seed: { lastInvokedSkillName: "muggle-do", mandatoryStages: [STAGE_PATH] },
    expectLanded: (state) => expect(state.stageBlockCount).toBe(1),
  },
  {
    writer: "e2e-gate",
    payload: {},
    seed: { unitTestsGreen: true },
    expectLanded: (state) => expect(state.e2eBlockCount).toBe(1),
  },
  {
    writer: "build-router",
    payload: { prompt: "implement a dark-mode toggle" },
    seed: {},
    expectLanded: (state) => expect(state.buildIntentRouted).toBe(true),
  },
  {
    writer: "capability-claim-gate",
    payload: {
      transcript_path: null,
      last_assistant_message: "I can't test the magic link login flow end to end, since there is no inbox.",
    },
    seed: {},
    expectLanded: (state) => expect(state.capabilityClaimNudged).toBe(true),
  },
];

function runHook(subcommand: string, home: string, payload: unknown): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--import", "tsx", CLI, subcommand], {
      env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.stdin.end(JSON.stringify(payload));
    child.on("close", resolve);
  });
}

describe("a hook that changes session state while another writer holds its lock", () => {
  it.concurrent.each(stateWriterCases)(
    "$writer writes nothing around the holder, and its change lands beside the holder's commit",
    async ({ writer, payload, seed, expectLanded }) => {
      const sessionId = `held-${writer}`;
      const home = mkdtempSync(join(tmpdir(), "gr-writer-lock-"));
      const stateDir = join(home, ".muggle-ai", "guardrails");
      const stateFile = join(stateDir, `${sessionId}.json`);
      const lockFile = `${stateFile}.lock`;
      mkdirSync(stateDir, { recursive: true });
      const seeded = JSON.stringify({ sessionId: sessionId, prsHandled: [], ...seed });
      writeFileSync(stateFile, seeded);
      writeFileSync(lockFile, JSON.stringify({ pid: process.pid, host: hostname(), acquiredAt: new Date().toISOString() }));
      try {
        expect(await runHook(writer, home, { session_id: sessionId, ...payload })).toBe(0);
        expect(readFileSync(stateFile, "utf-8")).toBe(seeded);
        writeFileSync(stateFile, JSON.stringify({ ...JSON.parse(seeded), ...HOLDER_COMMIT }));
      } finally {
        unlinkSync(lockFile);
      }
      // The hook also started a detached commit; whichever of the two takes the lock first lands the change.
      commitDeferredStateMutations(sessionId, applyStateMutation, stateDir);
      const landed = JSON.parse(readFileSync(stateFile, "utf-8")) as GuardrailState;
      expect(landed).toMatchObject(HOLDER_COMMIT);
      expectLanded(landed);
    },
    HOOK_TIMEOUT_MS,
  );
});
