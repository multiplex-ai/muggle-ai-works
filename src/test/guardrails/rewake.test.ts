import { describe, it, expect, beforeEach } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { REWAKE_MESSAGE_PREFIX, SYNC_HOOK_OUTPUT_SUFFIX } from "../../guardrails/constants.js";
import { findSyncHookOutcome, payloadDigest, rewakeMessage, transcriptAnchor } from "../../guardrails/rewake.js";
import { takeSyncHookOutput, writeSyncHookOutput } from "../../guardrails/sessionState.js";
import { SyncHookOutcome } from "../../guardrails/types.js";
import { GUARDRAIL_STATE_PATH_SEGMENTS } from "./hook-harness/constants.js";
import { createHookHome, runGuardrailCli } from "./hook-harness/hookHarness.js";

const SYNC_STOP_COMMAND = 'set -- guardrail-dispatch.sh guardrail-capability-claim.sh; . "${CLAUDE_PLUGIN_ROOT}/scripts/hook-entry.sh"';
const REWAKE_STOP_COMMAND = 'set -- guardrail-rewake.sh guardrail-capability-claim.sh; . "${CLAUDE_PLUGIN_ROOT}/scripts/hook-entry.sh"';
const CLOSING_REPLY = "The emailed OTP makes this flow untestable in an automated run.";

const assistantLine = (text: string): string =>
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: text }] } });
const userLine = (text: string): string => JSON.stringify({ type: "user", message: { role: "user", content: text } });
const hookRecordLine = (record: Record<string, unknown>): string => JSON.stringify({ type: "attachment", attachment: record });
const stopRecord = (type: string, command?: string): string =>
  hookRecordLine({ type: type, hookName: "Stop", hookEvent: "Stop", ...(command ? { command: command } : {}) });
const anchorFor = (text: string): string => JSON.stringify(text).slice(1, -1);

describe("findSyncHookOutcome", () => {
  it("reads a cancelled synchronous guardrail run as cancelled", () => {
    const transcript = [assistantLine(CLOSING_REPLY), stopRecord("hook_cancelled", SYNC_STOP_COMMAND)].join("\n");
    expect(findSyncHookOutcome(transcript, "Stop", anchorFor(CLOSING_REPLY))).toBe(SyncHookOutcome.Cancelled);
  });

  it("reads a finished synchronous run as delivered", () => {
    const transcript = [assistantLine(CLOSING_REPLY), stopRecord("hook_success", SYNC_STOP_COMMAND)].join("\n");
    expect(findSyncHookOutcome(transcript, "Stop", anchorFor(CLOSING_REPLY))).toBe(SyncHookOutcome.Delivered);
  });

  it("reads a block record that names no command as delivered", () => {
    const transcript = [assistantLine(CLOSING_REPLY), stopRecord("hook_blocking_error")].join("\n");
    expect(findSyncHookOutcome(transcript, "Stop", anchorFor(CLOSING_REPLY))).toBe(SyncHookOutcome.Delivered);
  });

  it("skips the companion's own record and another plugin's", () => {
    const transcript = [
      assistantLine(CLOSING_REPLY),
      stopRecord("hook_success", REWAKE_STOP_COMMAND),
      stopRecord("hook_success", "bash other-plugin.sh"),
      stopRecord("hook_cancelled", SYNC_STOP_COMMAND),
    ].join("\n");
    expect(findSyncHookOutcome(transcript, "Stop", anchorFor(CLOSING_REPLY))).toBe(SyncHookOutcome.Cancelled);
  });

  it("ignores an earlier turn's record and waits for this event's", () => {
    const transcript = [
      assistantLine("an earlier reply"),
      stopRecord("hook_cancelled", SYNC_STOP_COMMAND),
      assistantLine(CLOSING_REPLY),
    ].join("\n");
    expect(findSyncHookOutcome(transcript, "Stop", anchorFor(CLOSING_REPLY))).toBe(SyncHookOutcome.Unrecorded);
  });

  it("anchors a prompt's record on the prompt's user line", () => {
    const transcript = [
      userLine("build the CSV export"),
      hookRecordLine({ type: "hook_cancelled", hookEvent: "UserPromptSubmit", command: "set -- guardrail-build-router.sh; . x" }),
    ].join("\n");
    expect(findSyncHookOutcome(transcript, "UserPromptSubmit", anchorFor("build the CSV export"))).toBe(
      SyncHookOutcome.Cancelled,
    );
  });

  it("matches records whatever their JSON spacing", () => {
    const transcript = [
      JSON.stringify(JSON.parse(assistantLine(CLOSING_REPLY)), null, 1).replace(/\n/g, ""),
      JSON.stringify(JSON.parse(stopRecord("hook_cancelled", SYNC_STOP_COMMAND)), null, 1).replace(/\n/g, ""),
    ].join("\n");
    expect(findSyncHookOutcome(transcript, "Stop", anchorFor(CLOSING_REPLY))).toBe(SyncHookOutcome.Cancelled);
  });

  it("is unrecorded when the event's line is not in the tail", () => {
    expect(findSyncHookOutcome(stopRecord("hook_cancelled", SYNC_STOP_COMMAND), "Stop", "missing")).toBe(
      SyncHookOutcome.Unrecorded,
    );
  });
});

describe("transcriptAnchor", () => {
  it("takes the end of a Stop's closing reply, escaped as the transcript stores it", () => {
    expect(transcriptAnchor({ hook_event_name: "Stop", last_assistant_message: 'said "done"\n' })).toBe('said \\"done\\"');
  });

  it("takes the start of a prompt", () => {
    expect(transcriptAnchor({ hook_event_name: "UserPromptSubmit", prompt: "  fix it" })).toBe("fix it");
  });

  it("has none for an event without a companion or an empty reply", () => {
    expect(transcriptAnchor({ hook_event_name: "PostToolUse", prompt: "x" })).toBeUndefined();
    expect(transcriptAnchor({ hook_event_name: "Stop", last_assistant_message: "  " })).toBeUndefined();
  });
});

describe("rewakeMessage", () => {
  it("delivers a Stop block's reason under the Stop prefix", () => {
    expect(rewakeMessage("Stop", JSON.stringify({ decision: "block", reason: "run E2E" }))).toBe(
      `${REWAKE_MESSAGE_PREFIX.Stop}\n\nrun E2E`,
    );
  });

  it("delivers a prompt hook's context", () => {
    const hookOutput = JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "route it" } });
    expect(rewakeMessage("UserPromptSubmit", hookOutput)).toBe(`${REWAKE_MESSAGE_PREFIX.UserPromptSubmit}\n\nroute it`);
  });

  it("says nothing for an empty answer or output that is not JSON", () => {
    expect(rewakeMessage("Stop", "{}")).toBe("");
    expect(rewakeMessage("Stop", "not json")).toBe("");
  });
});

describe("sync hook output sidecar", () => {
  let stateDir: string;
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "gr-sync-output-"));
  });

  it("hands the saved output to the firing it belongs to, once", () => {
    writeSyncHookOutput("s1", "Stop", { payloadDigest: "abc", hookOutput: "{}" }, stateDir);
    expect(takeSyncHookOutput("s1", "Stop", "abc", stateDir)).toEqual({ payloadDigest: "abc", hookOutput: "{}" });
    expect(takeSyncHookOutput("s1", "Stop", "abc", stateDir)).toBeNull();
  });

  it("leaves another firing's output for that firing's companion", () => {
    writeSyncHookOutput("s1", "Stop", { payloadDigest: "newer", hookOutput: "{}" }, stateDir);
    expect(takeSyncHookOutput("s1", "Stop", "older", stateDir)).toBeNull();
    expect(existsSync(join(stateDir, `s1.Stop${SYNC_HOOK_OUTPUT_SUFFIX}`))).toBe(true);
  });
});

describe("rewake (cli entry)", () => {
  let home: string;
  let transcriptPath: string;
  beforeEach(() => {
    home = createHookHome("gr-rewake-");
    transcriptPath = join(home, "transcript.jsonl");
  });

  const stopPayload = (sessionId: string): string =>
    JSON.stringify({
      session_id: sessionId,
      hook_event_name: "Stop",
      transcript_path: transcriptPath,
      last_assistant_message: CLOSING_REPLY,
    });

  it("wakes Claude with the gate's block when the synchronous run was cancelled", () => {
    writeFileSync(transcriptPath, [assistantLine(CLOSING_REPLY), stopRecord("hook_cancelled", SYNC_STOP_COMMAND)].join("\n"));
    const rewakeRun = runGuardrailCli({ home: home, cliArgs: ["rewake", "capability-claim-gate"], stdin: stopPayload("rw-a") });
    expect(rewakeRun.status).toBe(2);
    expect(rewakeRun.stderr).toContain(REWAKE_MESSAGE_PREFIX.Stop);
    expect(rewakeRun.stderr).toContain("Muggle clears");
  });

  it("stays silent when the synchronous run delivered", () => {
    writeFileSync(transcriptPath, [assistantLine(CLOSING_REPLY), stopRecord("hook_success", SYNC_STOP_COMMAND)].join("\n"));
    const rewakeRun = runGuardrailCli({ home: home, cliArgs: ["rewake", "capability-claim-gate"], stdin: stopPayload("rw-b") });
    expect(rewakeRun.status).toBe(0);
    expect(rewakeRun.stderr).toBe("");
  });

  it("delivers the output the cancelled run saved, which a re-run of its gate would no longer give", () => {
    const payload = stopPayload("rw-c");
    const syncRun = runGuardrailCli({ home: home, cliArgs: ["capability-claim-gate"], stdin: payload });
    expect(JSON.parse(syncRun.stdout).decision).toBe("block");
    writeFileSync(transcriptPath, [assistantLine(CLOSING_REPLY), stopRecord("hook_cancelled", SYNC_STOP_COMMAND)].join("\n"));

    const rewakeRun = runGuardrailCli({ home: home, cliArgs: ["rewake", "capability-claim-gate"], stdin: payload });
    expect(rewakeRun.status).toBe(2);
    expect(rewakeRun.stderr).toContain("Muggle clears");
    expect(existsSync(join(home, ...GUARDRAIL_STATE_PATH_SEGMENTS, `rw-c.Stop${SYNC_HOOK_OUTPUT_SUFFIX}`))).toBe(false);
  });

  it("keeps one payload's digest across the synchronous run and its companion", () => {
    expect(payloadDigest(stopPayload("rw-d"))).toBe(payloadDigest(stopPayload("rw-d")));
  });
});
