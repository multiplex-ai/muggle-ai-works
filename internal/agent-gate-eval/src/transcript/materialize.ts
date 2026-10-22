/**
 * Turns a scenario's seeded transcript into turns ready to replay: fills in
 * the run's paths, names each tool as the session does, and answers each call
 * as the live run would — a Read from the file itself, a Write or Edit applied
 * to the sandbox, everything else from the scenario's scripts — so every file
 * the history claims to have read or written is the file the run finds.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import {
  EDIT_CONFIRMATION_PARTS,
  MUGGLE_TOOL_NAME_PREFIX,
  SIMULATED_OUTPUT_PREFIX,
  TRANSCRIPT_FILE_TOOLS,
  WRITE_CONFIRMATION_PREFIX,
} from "../constants.js";
import { decideFileToolUse } from "../tools/policy.js";
import { sessionToolName } from "../tools/trace.js";
import {
  ScriptedTool,
  TranscriptPathToken,
  type MaterializedToolCall,
  type MaterializedTurn,
  type SandboxPathContext,
  type SeedTranscript,
  type TranscriptMaterializeContext,
  type TranscriptToolCall,
} from "../types.js";

/** What each path token stands for in one run. */
export function transcriptPathsByToken(
  paths: SandboxPathContext,
  pluginRoot: string,
): Record<TranscriptPathToken, string> {
  return {
    [TranscriptPathToken.Home]: paths.home,
    [TranscriptPathToken.Repo]: paths.repo,
    [TranscriptPathToken.PluginRoot]: pluginRoot,
  };
}

/**
 * The value with every path token in every string replaced, recursing into
 * arrays and objects.
 *
 * @param pathsByToken - What each `TranscriptPathToken` stands for in this run.
 */
export function fillTranscriptPaths<Value>(value: Value, pathsByToken: Record<TranscriptPathToken, string>): Value {
  if (typeof value === "string") {
    let filled: string = value;
    for (const token of Object.values(TranscriptPathToken)) filled = filled.split(token).join(pathsByToken[token]);
    return filled as Value;
  }
  if (Array.isArray(value)) return value.map((entry) => fillTranscriptPaths(entry, pathsByToken)) as Value;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, fillTranscriptPaths(entry, pathsByToken)]),
    ) as Value;
  }
  return value;
}

/**
 * A file's content as the Read tool returns it: each line behind its 1-based
 * number and a tab.
 *
 * Output shape: `"1\t# Title\n2\t"`
 */
export function formatReadResult(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line, index) => `${index + 1}\t${line}`)
    .join("\n");
}

function applyEdit(target: string, input: Record<string, unknown>, label: string): void {
  const { old_string: oldText, new_string: newText, replace_all: replaceAll } = input;
  if (typeof oldText !== "string" || typeof newText !== "string") {
    throw new Error(`${label}: Edit needs old_string and new_string`);
  }
  const original = fs.readFileSync(target, "utf8");
  // A checkout that converts line endings leaves fixture files CRLF; match the transcript's LF text against them alike.
  const lineEnding = original.includes("\r\n") ? "\r\n" : "\n";
  const [matchText, replacementText] = [oldText, newText].map((text) => text.replace(/\r?\n/g, lineEnding));
  const occurrences = original.split(matchText).length - 1;
  if (occurrences === 0 || (occurrences > 1 && replaceAll !== true)) {
    throw new Error(`${label}: Edit old_string occurs ${occurrences} times in ${target}; it must occur exactly once`);
  }
  fs.writeFileSync(target, original.split(matchText).join(replacementText));
}

function answerFileCall(
  toolCall: TranscriptToolCall,
  context: TranscriptMaterializeContext,
  label: string,
): string {
  const decision = decideFileToolUse(toolCall.tool, toolCall.input, context);
  if (decision.behavior !== "allow") throw new Error(`${label}: ${decision.message}`);
  const target = String(decision.updatedInput?.file_path);
  const displayPath = String(toolCall.input.file_path);
  if (toolCall.tool === "Read") {
    if (toolCall.result !== undefined) return toolCall.result;
    if (!fs.existsSync(target)) throw new Error(`${label}: Read of ${target}, which the sandbox and plugin tree lack`);
    return formatReadResult(fs.readFileSync(target, "utf8"));
  }
  if (toolCall.tool === "Write") {
    if (typeof toolCall.input.content !== "string") throw new Error(`${label}: Write needs content`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, toolCall.input.content);
    return toolCall.result ?? `${WRITE_CONFIRMATION_PREFIX}${displayPath}`;
  }
  applyEdit(target, toolCall.input, label);
  return toolCall.result ?? `${EDIT_CONFIRMATION_PARTS[0]}${displayPath}${EDIT_CONFIRMATION_PARTS[1]}`;
}

function materializeToolCall(
  toolCall: TranscriptToolCall,
  context: TranscriptMaterializeContext,
  label: string,
): MaterializedToolCall {
  const replyFor = (replyText: string, isError: boolean): MaterializedToolCall => ({
    sessionToolName: sessionToolName(toolCall.tool),
    input: toolCall.input,
    result: replyText,
    isError: isError,
  });
  if (TRANSCRIPT_FILE_TOOLS.includes(toolCall.tool)) return replyFor(answerFileCall(toolCall, context, label), false);
  if (toolCall.tool === "Bash") {
    const output = toolCall.result ?? context.answerBash(String(toolCall.input.command ?? ""));
    return replyFor(`${SIMULATED_OUTPUT_PREFIX}${output}`, true);
  }
  if (toolCall.result !== undefined) return replyFor(toolCall.result, false);
  if ((Object.values(ScriptedTool) as string[]).includes(toolCall.tool)) {
    const scriptedTool = toolCall.tool as ScriptedTool;
    // The live harness answers AskUserQuestion with a denial; every other scripted tool runs as a stub.
    return replyFor(context.answerTool(scriptedTool, JSON.stringify(toolCall.input)), scriptedTool === ScriptedTool.AskUserQuestion);
  }
  if (toolCall.tool.startsWith(MUGGLE_TOOL_NAME_PREFIX)) return replyFor(context.answerMockTool(toolCall.tool), false);
  throw new Error(`${label}: ${toolCall.tool} has no result and nothing in this eval answers it`);
}

/**
 * The transcript's turns with paths filled in, each tool named as the session
 * calls it, and each result known. Write and Edit calls are applied to the
 * sandbox in order as they are reached; a Bash call's result carries the
 * scripted-output denial the live harness answers with.
 *
 * @throws when a file call falls outside what the run's tool policy allows, a
 * Read names a missing file, an Edit's old_string does not occur exactly once,
 * or a call has no result and nothing answers it.
 */
export function materializeTranscript(
  transcript: SeedTranscript,
  context: TranscriptMaterializeContext,
): MaterializedTurn[] {
  const pathsByToken = transcriptPathsByToken(context.paths, context.pluginRoot);
  return transcript.turns.map((turn, turnIndex) => ({
    text: turn.text === undefined ? undefined : fillTranscriptPaths(turn.text, pathsByToken),
    toolCalls: (turn.toolCalls ?? []).map((toolCall, callIndex) =>
      materializeToolCall(
        fillTranscriptPaths(toolCall, pathsByToken),
        context,
        `seed.transcript.turns[${turnIndex}].toolCalls[${callIndex}]`,
      ),
    ),
  }));
}
