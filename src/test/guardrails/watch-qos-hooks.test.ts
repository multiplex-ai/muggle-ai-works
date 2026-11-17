import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { MAX_WATCH_BLOCKS } from "../../guardrails/constants.js";
import { WATCH_QOS_LEDGER_ENV_VAR } from "../../watch-qos/constants.js";
import { hashWatchQosIdentity } from "../../watch-qos/identity.js";
import { WatchQosDetector, WatchQosHost, WatchQosSignal, type WatchQosLedgerRecord } from "../../watch-qos/types.js";
import { createHookHome, runGuardrailCli, writeGuardrailState, writeSessionSlotFiles } from "./hook-harness/hookHarness.js";
import { WATCH_FIXTURE_REPO } from "./support/constants.js";
import { watchSlotFiles } from "./support/watchSlotFixture.js";

const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugin", import.meta.url));
const RECORD_ENTRY = join(PLUGIN_ROOT, "scripts", "watch-qos-record.mjs");
const HEAD = "1111111111111111111111111111111111111111";
const PR_URL = "https://github.com/o/r/pull/77";

// The suite switches the ledger off for every other test; these turn it back on inside a throwaway HOME.
function runHook(home: string, subcommand: string, payload: object): string {
  return runGuardrailCli({
    home: home,
    cliArgs: [subcommand],
    stdin: JSON.stringify(payload),
    env: { ...process.env, [WATCH_QOS_LEDGER_ENV_VAR]: "", CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
  }).stdout;
}

function ledgerOf(home: string): WatchQosLedgerRecord[] {
  const ledgerFile = join(home, ".muggle-ai", "telemetry", "watch-qos.jsonl");
  if (!existsSync(ledgerFile)) return [];
  return readFileSync(ledgerFile, "utf-8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as WatchQosLedgerRecord);
}

function subjectIdOf(home: string, prReference: string): string {
  const salt = (JSON.parse(readFileSync(join(home, ".muggle-ai", "install-id.json"), "utf-8")) as { installId: string }).installId;
  return hashWatchQosIdentity(prReference, salt);
}

function openPr(home: string, sessionId: string, prUrl: string = PR_URL): void {
  runHook(home, "pr-opened", {
    session_id: sessionId,
    tool_name: "Bash",
    tool_input: { command: "gh pr create" },
    tool_response: { stdout: `${prUrl}\n` },
  });
}

describe("turn-end watch gate QoS detectors", () => {
  it("records pr-opened once for a PR the session handled, under its hashed identity", () => {
    const home = createHookHome("qos-pr-opened-");
    openPr(home, "s-open");
    openPr(home, "s-open");
    const ledger = ledgerOf(home);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      signal: WatchQosSignal.PrOpened,
      detector: WatchQosDetector.TurnEndGate,
      host: WatchQosHost.ClaudeCode,
      subjectId: subjectIdOf(home, "o/r#77"),
    });
    expect(JSON.stringify(ledger[0])).not.toContain("o/r");
  });

  it("records watch-missed for each unwatched PR when the gate gives up after its block budget", () => {
    const home = createHookHome("qos-watch-missed-");
    writeGuardrailState(home, { sessionId: "s-missed", prsHandled: [PR_URL], watchBlockCount: MAX_WATCH_BLOCKS });
    expect(runHook(home, "watch-gate", { session_id: "s-missed" })).toBe("{}");
    expect(ledgerOf(home).map((record) => record.signal)).toEqual([WatchQosSignal.WatchMissed]);
  });

  it("records no miss while the gate is still blocking", () => {
    const home = createHookHome("qos-watch-blocking-");
    openPr(home, "s-blocking");
    expect(JSON.parse(runHook(home, "watch-gate", { session_id: "s-blocking" })).decision).toBe("block");
    expect(ledgerOf(home).map((record) => record.signal)).toEqual([WatchQosSignal.PrOpened]);
  });

  it("records watch-skipped for the unwatched PRs when the owner declares MUGGLE_WATCH_SKIP, never a miss", () => {
    const home = createHookHome("qos-watch-skipped-");
    openPr(home, "s-skip");
    runHook(home, "record-tests", {
      session_id: "s-skip",
      tool_name: "Bash",
      tool_input: { command: 'echo "MUGGLE_WATCH_SKIP: handed off to another session"' },
      tool_response: { stdout: "MUGGLE_WATCH_SKIP: handed off to another session" },
    });
    runHook(home, "watch-gate", { session_id: "s-skip" });
    expect(ledgerOf(home).map((record) => record.signal)).toEqual([WatchQosSignal.PrOpened, WatchQosSignal.WatchSkipped]);
  });

  it("records a PR opened after a skip as both opened and skipped", () => {
    const home = createHookHome("qos-skip-then-open-");
    writeGuardrailState(home, { sessionId: "s-skip-first", prsHandled: [], watchSkipped: true });
    openPr(home, "s-skip-first");
    expect(ledgerOf(home).map((record) => record.signal)).toEqual([WatchQosSignal.PrOpened, WatchQosSignal.WatchSkipped]);
  });
});

describe("follow-through gate QoS detector", () => {
  it("records ci-red-caught-at-turn-end once per red head it had to force, timed from when the head was observed red", () => {
    const home = createHookHome("qos-caught-");
    writeSessionSlotFiles(home, "repo-pr7", watchSlotFiles({ ownerSessionId: "s-caught", prNumber: 7, headSha: HEAD, ciRedHeadSha: HEAD }));
    const payload = { session_id: "s-caught", stop_hook_active: false };
    expect(JSON.parse(runHook(home, "watch-follow-through-gate", payload)).decision).toBe("block");
    expect(JSON.parse(runHook(home, "watch-follow-through-gate", payload)).decision).toBe("block");
    const caught = ledgerOf(home).filter((record) => record.signal === WatchQosSignal.CiRedCaughtAtTurnEnd);
    expect(caught).toHaveLength(1);
    expect(caught[0]).toMatchObject({
      detector: WatchQosDetector.FollowThroughGate,
      subjectId: subjectIdOf(home, `${WATCH_FIXTURE_REPO}#7`),
    });
  });

  it("times the catch from the loop's ci-red-observed record of the same head", () => {
    const home = createHookHome("qos-caught-delay-");
    spawnSync(
      process.execPath,
      [RECORD_ENTRY, "--signal", "ci-red-observed", "--detector", "watch-loop", "--repo", WATCH_FIXTURE_REPO, "--pr", "7", "--head", HEAD],
      { env: { ...process.env, HOME: home, USERPROFILE: home, [WATCH_QOS_LEDGER_ENV_VAR]: "" }, windowsHide: true },
    );
    writeSessionSlotFiles(home, "repo-pr7", watchSlotFiles({ ownerSessionId: "s-delay", prNumber: 7, headSha: HEAD, ciRedHeadSha: HEAD }));
    runHook(home, "watch-follow-through-gate", { session_id: "s-delay", stop_hook_active: false });
    const [observed, caught] = ledgerOf(home);
    expect(observed.signal).toBe(WatchQosSignal.CiRedObserved);
    expect(caught).toMatchObject({ signal: WatchQosSignal.CiRedCaughtAtTurnEnd, headId: observed.headId, subjectId: observed.subjectId });
    expect(typeof caught.delaySeconds).toBe("number");
  });

  it("records nothing for due work other than red CI", () => {
    const home = createHookHome("qos-rebase-only-");
    writeSessionSlotFiles(
      home,
      "repo-pr7",
      watchSlotFiles({ ownerSessionId: "s-rebase", prNumber: 7, headSha: HEAD, rebaseDueKey: `${HEAD}..2222` }),
    );
    runHook(home, "watch-follow-through-gate", { session_id: "s-rebase", stop_hook_active: false });
    expect(ledgerOf(home)).toEqual([]);
  });
});
