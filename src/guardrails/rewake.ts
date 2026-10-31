import { createHash } from "crypto";
import {
  COMMANDLESS_HOOK_DELIVERY_TYPES,
  GUARDRAIL_HOOK_COMMAND_MARKER,
  REWAKE_ANCHOR_ROLE_BY_EVENT,
  REWAKE_ANCHOR_CHARS,
  REWAKE_HOOK_SCRIPT,
  REWAKE_MESSAGE_PREFIX,
  TRANSCRIPT_HOOK_CANCELLED_TYPE,
  TRANSCRIPT_HOOK_RECORD_TYPE_PREFIX,
} from "./constants.js";
import { SyncHookOutcome, type GuardrailHookOutput, type HookInput, type TranscriptHookRecord } from "./types.js";

/** Identifies one hook payload: a synchronous run and its rewake companion are handed the same bytes. */
export function payloadDigest(rawPayload: string): string {
  return createHash("sha1").update(rawPayload).digest("hex");
}

/**
 * Text that finds the event's own line in the transcript — the end of the closing reply for a Stop, the start of the
 * prompt for a UserPromptSubmit — escaped the way the JSONL transcript stores it.
 * @returns undefined when the payload carries neither, or the event has no companion.
 */
export function transcriptAnchor(input: HookInput): string | undefined {
  const anchorText =
    input.hook_event_name === "Stop"
      ? input.last_assistant_message?.trimEnd().slice(-REWAKE_ANCHOR_CHARS)
      : input.hook_event_name === "UserPromptSubmit"
        ? input.prompt?.trimStart().slice(0, REWAKE_ANCHOR_CHARS)
        : undefined;
  if (!anchorText?.trim()) return undefined;
  return JSON.stringify(anchorText).slice(1, -1);
}

// Claude Code writes the transcript as compact JSON; the pattern tolerates spacing so the match does not hang on it.
const jsonFieldPattern = (field: string, value: string): RegExp => new RegExp(`"${field}"\\s*:\\s*"${value}"`);

function parseHookRecord(line: string, hookEventName: string): TranscriptHookRecord | undefined {
  if (!jsonFieldPattern("hookEvent", hookEventName).test(line)) return undefined;
  try {
    const record = (JSON.parse(line) as { attachment?: TranscriptHookRecord }).attachment;
    if (!record?.type?.startsWith(TRANSCRIPT_HOOK_RECORD_TYPE_PREFIX) || record.hookEvent !== hookEventName) return undefined;
    return record;
  } catch {
    return undefined;
  }
}

function isSyncGuardrailCommand(command: string): boolean {
  return command.includes(GUARDRAIL_HOOK_COMMAND_MARKER) && !command.includes(REWAKE_HOOK_SCRIPT);
}

/**
 * How the transcript says Claude Code ended the synchronous guardrail run for the event `anchor` locates: the first
 * hook record after the event's line that is the guardrail's own, or that delivered output without naming a command.
 *
 * Output shape: `SyncHookOutcome.Cancelled` for `{"type":"hook_cancelled","hookEvent":"Stop","command":"set -- guardrail-dispatch.sh …"}`
 */
export function findSyncHookOutcome(transcriptTail: string, hookEventName: string, anchor: string): SyncHookOutcome {
  const lines = transcriptTail.split("\n");
  const anchorRolePattern = jsonFieldPattern("type", REWAKE_ANCHOR_ROLE_BY_EVENT[hookEventName] ?? "");
  let anchorIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].includes(anchor) && anchorRolePattern.test(lines[index])) {
      anchorIndex = index;
      break;
    }
  }
  if (anchorIndex < 0) return SyncHookOutcome.Unrecorded;
  for (const line of lines.slice(anchorIndex + 1)) {
    const record = parseHookRecord(line, hookEventName);
    if (!record) continue;
    if (typeof record.command === "string") {
      if (!isSyncGuardrailCommand(record.command)) continue;
      return record.type === TRANSCRIPT_HOOK_CANCELLED_TYPE ? SyncHookOutcome.Cancelled : SyncHookOutcome.Delivered;
    }
    if (COMMANDLESS_HOOK_DELIVERY_TYPES.includes(record.type)) return SyncHookOutcome.Delivered;
  }
  return SyncHookOutcome.Unrecorded;
}

/**
 * The message a rewake companion wakes Claude with: the Stop block's reason or the prompt context the cancelled run
 * would have returned, under a line naming the check.
 * @returns "" when the output holds nothing to deliver.
 */
export function rewakeMessage(hookEventName: string, hookOutput: string): string {
  let parsedOutput: GuardrailHookOutput;
  try {
    parsedOutput = JSON.parse(hookOutput) as GuardrailHookOutput;
  } catch {
    return "";
  }
  const deliveredText =
    hookEventName === "Stop"
      ? parsedOutput.decision === "block"
        ? parsedOutput.reason
        : undefined
      : (parsedOutput.hookSpecificOutput?.additionalContext ?? parsedOutput.additional_context);
  if (!deliveredText) return "";
  return `${REWAKE_MESSAGE_PREFIX[hookEventName] ?? ""}\n\n${deliveredText}`;
}
