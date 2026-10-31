import {
  GUARDRAIL_DISPATCH_SCRIPT,
  GUARDRAIL_HOOK_COMMAND_MARKER,
  GUARDRAIL_SUBCOMMAND_ASSIGNMENT,
  HOOK_COMMAND_SCRIPTS,
  RECONCILED_HOOK_EVENT,
  REWAKE_HOOK_SCRIPT,
  TRANSCRIPT_HOOK_CANCELLED_TYPE,
} from "./constants.js";
import type {
  CancelledRecorderEvent,
  HookInput,
  TranscriptContentBlock,
  TranscriptLine,
  TranscriptToolCall,
} from "./types.js";

function parseTranscriptLines(transcriptTail: string): TranscriptLine[] {
  return transcriptTail.split("\n").flatMap((line): TranscriptLine[] => {
    try {
      return [JSON.parse(line) as TranscriptLine];
    } catch {
      return [];
    }
  });
}

function contentBlocks(line: TranscriptLine): TranscriptContentBlock[] {
  const content = line.message?.content;
  return Array.isArray(content) ? (content as TranscriptContentBlock[]) : [];
}

// The tool's result as Claude Code handed it to the hook: the structured `toolUseResult` the transcript keeps beside
// the result block, else the result text in the `{ output }` shape normalizeHookInput gives a bare string.
function toolResponseFor(line: TranscriptLine, block: TranscriptContentBlock): HookInput["tool_response"] {
  if (line.toolUseResult && typeof line.toolUseResult === "object") return line.toolUseResult as HookInput["tool_response"];
  if (typeof block.content === "string") return { output: block.content };
  return { content: block.content };
}

function isCancelledSyncRecorderRecord(record: TranscriptLine["attachment"]): boolean {
  if (record?.type !== TRANSCRIPT_HOOK_CANCELLED_TYPE || record.hookEvent !== RECONCILED_HOOK_EVENT) return false;
  const command = record.command ?? "";
  return command.includes(GUARDRAIL_HOOK_COMMAND_MARKER) && !command.includes(REWAKE_HOOK_SCRIPT);
}

/**
 * Every PostToolUse run of a synchronous guardrail command that the transcript records Claude Code cancelling after
 * the record `afterRecordUuid` names, each paired with the tool call and result it was fired for.
 *
 * A cancelled record whose tool call or result fell outside the tail cannot be rebuilt and is left out. When the
 * watermark record itself is not in the tail, every cancelled record in it is returned; replaying one twice changes
 * nothing, since the recorders' state writes are set-based.
 *
 * Output shape: `[{ recordUuid: "d50…", command: "set -- guardrail-dispatch.sh guardrail-record-tests.sh; …", replayPayload: { hook_event_name: "PostToolUse", tool_name: "Bash", … } }]`
 */
export function findCancelledRecorderEvents(
  transcriptTail: string,
  sessionInput: HookInput,
  afterRecordUuid?: string,
): CancelledRecorderEvent[] {
  const lines = parseTranscriptLines(transcriptTail);
  const toolCalls = new Map<string, TranscriptToolCall>();
  const toolResults = new Map<string, { line: TranscriptLine; block: TranscriptContentBlock }>();
  for (const line of lines) {
    for (const block of contentBlocks(line)) {
      if (block.type === "tool_use" && block.id) toolCalls.set(block.id, { name: block.name, input: block.input });
      if (block.type === "tool_result" && block.tool_use_id) toolResults.set(block.tool_use_id, { line: line, block: block });
    }
  }
  const watermarkIndex = afterRecordUuid ? lines.findIndex((line) => line.uuid === afterRecordUuid) : -1;
  return lines.slice(watermarkIndex + 1).flatMap((line): CancelledRecorderEvent[] => {
    const record = line.attachment;
    if (!line.uuid || !record || !isCancelledSyncRecorderRecord(record) || !record.toolUseID) return [];
    const toolCall = toolCalls.get(record.toolUseID);
    const toolResult = toolResults.get(record.toolUseID);
    if (!toolCall || !toolResult) return [];
    return [
      {
        recordUuid: line.uuid,
        command: record.command ?? "",
        replayPayload: {
          session_id: sessionInput.session_id,
          transcript_path: sessionInput.transcript_path,
          cwd: toolResult.line.cwd ?? line.cwd ?? sessionInput.cwd,
          hook_event_name: RECONCILED_HOOK_EVENT,
          tool_name: toolCall.name,
          tool_input: toolCall.input,
          tool_response: toolResponseFor(toolResult.line, toolResult.block),
          tool_use_id: record.toolUseID,
        },
      },
    ];
  });
}

/**
 * The guardrails.mjs subcommands a hooks.json command feeds: each gate script it names reports its own through its
 * GUARDRAIL_SUBCOMMAND assignment, which `readScript` returns the source holding.
 *
 * Output shape: `recorderSubcommands("set -- guardrail-dispatch.sh guardrail-pr-opened.sh guardrail-record-tests.sh; …", read)` → `["pr-opened", "record-tests"]`
 */
export function recorderSubcommands(command: string, readScript: (scriptName: string) => string | null): string[] {
  const scriptList = HOOK_COMMAND_SCRIPTS.exec(command)?.[1] ?? "";
  const scriptNames = scriptList.split(/\s+/).filter((scriptName) => scriptName && scriptName !== GUARDRAIL_DISPATCH_SCRIPT);
  const subcommands = scriptNames.flatMap((scriptName) => {
    const subcommand = GUARDRAIL_SUBCOMMAND_ASSIGNMENT.exec(readScript(scriptName) ?? "")?.[1];
    return subcommand ? [subcommand] : [];
  });
  return [...new Set(subcommands)];
}
