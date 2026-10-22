/**
 * Builds the session transcript a resumed run loads: one JSONL entry per
 * message, in the shape Claude Code writes, each linked to the one before it.
 */

import { randomUUID } from "node:crypto";

import type { SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";

import {
  TRANSCRIPT_MESSAGE_ID_PREFIX,
  TRANSCRIPT_TOOL_USE_ID_PREFIX,
  TRANSCRIPT_USER_TYPE,
} from "../constants.js";
import type { MaterializedTurn, TranscriptEntryContext } from "../types.js";

/**
 * The transcript entries for a run's first user message and its prior turns:
 * the user message, then per turn an assistant message (its text, then a
 * tool_use per call) and, when it called tools, a user message carrying each
 * tool_result.
 *
 * Output shape:
 *
 *     [{ type: "user", uuid, parentUuid: null, sessionId, cwd, timestamp, message: { role: "user", content: "<invocation>" } },
 *      { type: "assistant", uuid, parentUuid: <previous uuid>, …, message: { role: "assistant", content: [{ type: "tool_use", … }], … } },
 *      { type: "user", …, message: { role: "user", content: [{ type: "tool_result", tool_use_id, content, is_error? }] } }]
 */
export function buildTranscriptEntries(
  firstUserMessage: string,
  turns: MaterializedTurn[],
  context: TranscriptEntryContext,
): SessionStoreEntry[] {
  const entries: SessionStoreEntry[] = [];
  let parentUuid: string | null = null;
  const appendEntry = (type: "user" | "assistant", message: Record<string, unknown>): void => {
    const uuid = randomUUID();
    entries.push({
      type: type,
      uuid: uuid,
      parentUuid: parentUuid,
      isSidechain: false,
      userType: TRANSCRIPT_USER_TYPE,
      cwd: context.cwd,
      sessionId: context.sessionId,
      timestamp: new Date(context.startedAt.getTime() + entries.length * 1000).toISOString(),
      message: message,
    });
    parentUuid = uuid;
  };

  appendEntry("user", { role: "user", content: firstUserMessage });
  let toolUseCount = 0;
  turns.forEach((turn, turnIndex) => {
    const toolUses = turn.toolCalls.map((toolCall) => ({
      type: "tool_use",
      id: `${TRANSCRIPT_TOOL_USE_ID_PREFIX}${++toolUseCount}`,
      name: toolCall.sessionToolName,
      input: toolCall.input,
    }));
    appendEntry("assistant", {
      id: `${TRANSCRIPT_MESSAGE_ID_PREFIX}${turnIndex + 1}`,
      type: "message",
      role: "assistant",
      model: context.model,
      content: [...(turn.text ? [{ type: "text", text: turn.text }] : []), ...toolUses],
      stop_reason: toolUses.length > 0 ? "tool_use" : "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    if (toolUses.length === 0) return;
    appendEntry("user", {
      role: "user",
      content: turn.toolCalls.map((toolCall, callIndex) => ({
        type: "tool_result",
        tool_use_id: toolUses[callIndex].id,
        content: toolCall.result,
        ...(toolCall.isError ? { is_error: true } : {}),
      })),
    });
  });
  return entries;
}
