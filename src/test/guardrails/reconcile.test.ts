import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { RECONCILED_RECORD_SUFFIX } from "../../guardrails/constants.js";
import { findCancelledRecorderEvents, recorderSubcommands } from "../../guardrails/reconcile.js";
import { createHookHome, guardrailStateFile, runGuardrailCli } from "./hook-harness/hookHarness.js";
import { GUARDRAIL_STATE_PATH_SEGMENTS } from "./hook-harness/constants.js";

const PLUGIN_ROOT = fileURLToPath(new URL("../../../plugin", import.meta.url));
const RECORDER_COMMAND = 'set -- guardrail-dispatch.sh guardrail-record-tests.sh; . "${CLAUDE_PLUGIN_ROOT}/scripts/hook-entry.sh"';
const TEST_OUTPUT = "Test Files  1 passed (1)\n     Tests  3 passed (3)\n";

const toolCallLine = (toolUseId: string, command: string): string =>
  JSON.stringify({
    type: "assistant",
    uuid: `call-${toolUseId}`,
    message: { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: "Bash", input: { command: command } }] },
  });
const toolResultLine = (toolUseId: string, stdout: string): string =>
  JSON.stringify({
    type: "user",
    uuid: `result-${toolUseId}`,
    cwd: "/repo",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: toolUseId, content: stdout }] },
    toolUseResult: { stdout: stdout, stderr: "", interrupted: false },
  });
const cancelledLine = (recordUuid: string, toolUseId: string, command = RECORDER_COMMAND): string =>
  JSON.stringify({
    type: "attachment",
    uuid: recordUuid,
    attachment: { type: "hook_cancelled", hookName: "PostToolUse:Bash", hookEvent: "PostToolUse", toolUseID: toolUseId, command: command },
  });

describe("findCancelledRecorderEvents", () => {
  const session = { session_id: "s1", transcript_path: "/t.jsonl", cwd: "/fallback" };

  it("rebuilds a cancelled recorder run's payload from its tool call and result", () => {
    const transcript = [toolCallLine("toolu_a", "pnpm test"), toolResultLine("toolu_a", TEST_OUTPUT), cancelledLine("rec-1", "toolu_a")].join("\n");
    expect(findCancelledRecorderEvents(transcript, session)).toEqual([
      {
        recordUuid: "rec-1",
        command: RECORDER_COMMAND,
        replayPayload: {
          session_id: "s1",
          transcript_path: "/t.jsonl",
          cwd: "/repo",
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "pnpm test" },
          tool_response: { stdout: TEST_OUTPUT, stderr: "", interrupted: false },
          tool_use_id: "toolu_a",
        },
      },
    ]);
  });

  it("returns only records written after the watermark", () => {
    const transcript = [
      toolCallLine("toolu_a", "pnpm test"),
      toolResultLine("toolu_a", TEST_OUTPUT),
      cancelledLine("rec-1", "toolu_a"),
      toolCallLine("toolu_b", "pnpm test"),
      toolResultLine("toolu_b", TEST_OUTPUT),
      cancelledLine("rec-2", "toolu_b"),
    ].join("\n");
    expect(findCancelledRecorderEvents(transcript, session, "rec-1").map((event) => event.recordUuid)).toEqual(["rec-2"]);
  });

  it("skips the rewake companion's records, other plugins' hooks, and calls whose result left the tail", () => {
    const transcript = [
      toolCallLine("toolu_a", "pnpm test"),
      toolResultLine("toolu_a", TEST_OUTPUT),
      cancelledLine("rec-rewake", "toolu_a", "set -- guardrail-rewake.sh guardrail-record-tests.sh; . x"),
      cancelledLine("rec-other", "toolu_a", "bash other-plugin.sh"),
      toolCallLine("toolu_b", "pnpm test"),
      cancelledLine("rec-no-result", "toolu_b"),
    ].join("\n");
    expect(findCancelledRecorderEvents(transcript, session)).toEqual([]);
  });

  it("falls back to the result text when the transcript kept no structured result", () => {
    const resultWithoutStructure = JSON.stringify({
      type: "user",
      uuid: "result-toolu_a",
      message: { content: [{ type: "tool_result", tool_use_id: "toolu_a", content: "ok" }] },
    });
    const transcript = [toolCallLine("toolu_a", "ls"), resultWithoutStructure, cancelledLine("rec-1", "toolu_a")].join("\n");
    expect(findCancelledRecorderEvents(transcript, session)[0].replayPayload.tool_response).toEqual({ output: "ok" });
  });
});

describe("recorderSubcommands", () => {
  const scripts: Record<string, string> = {
    "guardrail-pr-opened.sh": 'GUARDRAIL_SUBCOMMAND="pr-opened"\n',
    "guardrail-record-tests.sh": '# x\nGUARDRAIL_SUBCOMMAND="record-tests"\n',
  };

  it("names each gate script's subcommand, skipping the dispatcher and unreadable scripts", () => {
    const command = 'set -- guardrail-dispatch.sh guardrail-pr-opened.sh guardrail-gone.sh guardrail-record-tests.sh; . x';
    expect(recorderSubcommands(command, (scriptName) => scripts[scriptName] ?? null)).toEqual(["pr-opened", "record-tests"]);
  });

  it("names nothing for a command that does not hand hook-entry.sh its scripts", () => {
    expect(recorderSubcommands("bash other.sh", () => null)).toEqual([]);
  });
});

describe("reconcile (cli entry)", () => {
  let home: string;
  let transcriptPath: string;
  beforeEach(() => {
    home = createHookHome("gr-reconcile-");
    transcriptPath = join(home, "transcript.jsonl");
  });

  it("recovers a cancelled test run's record before the Stop companion finishes", () => {
    const closingReply = "Tests pass.";
    writeFileSync(
      transcriptPath,
      [
        toolCallLine("toolu_a", "pnpm test"),
        toolResultLine("toolu_a", TEST_OUTPUT),
        cancelledLine("rec-1", "toolu_a"),
        JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: closingReply }] } }),
        JSON.stringify({
          type: "attachment",
          attachment: { type: "hook_success", hookName: "Stop", hookEvent: "Stop", command: "set -- guardrail-dispatch.sh; . x" },
        }),
      ].join("\n"),
    );
    const stopPayload = JSON.stringify({
      session_id: "rc-a",
      hook_event_name: "Stop",
      transcript_path: transcriptPath,
      last_assistant_message: closingReply,
    });

    const rewakeRun = runGuardrailCli({
      home: home,
      cliArgs: ["rewake"],
      stdin: stopPayload,
      env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    });

    expect(rewakeRun.status).toBe(0);
    expect(JSON.parse(readFileSync(guardrailStateFile(home, "rc-a"), "utf-8")).unitTestsGreen).toBe(true);
    expect(readFileSync(join(home, ...GUARDRAIL_STATE_PATH_SEGMENTS, `rc-a${RECONCILED_RECORD_SUFFIX}`), "utf-8")).toBe("rec-1");
  });
});
