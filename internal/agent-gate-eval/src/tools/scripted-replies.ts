/**
 * Answers for the calls the harness never runs. The first scripted entry that
 * matches a call answers it; an entry with a `sequence` gives its nth matching
 * call the nth entry, repeating the last once exhausted.
 */

import { NO_USER_RESPONSE, UNSCRIPTED_BASH_RESPONSE, UNSCRIPTED_TOOL_RESPONSE } from "../constants.js";
import {
  ScriptedTool,
  type ScriptedBashResponse,
  type ScriptedReply,
  type ScriptedToolResponses,
} from "../types.js";
import { builtinOutput, chainedCommands } from "./shell-command.mjs";

/** The nth (0-based) entry of a non-empty sequence, or its last entry once `callIndex` runs past the end. */
export function sequenceEntryAt<Entry>(sequence: Entry[], callIndex: number): Entry {
  return sequence[Math.min(callIndex, sequence.length - 1)];
}

/** The reply a scripted entry gives its nth (0-based) matching call. */
export function scriptedReplyAt(reply: ScriptedReply, callIndex: number): string {
  const sequence = reply.sequence ?? [];
  return sequence.length > 0 ? sequenceEntryAt(sequence, callIndex) : (reply.response ?? "");
}

/**
 * A stateful answerer for one run: each call is answered by the first entry it
 * matches, at that entry's own call count.
 *
 * @param entries - Scripted entries, in declaration order.
 * @param isMatch - Whether an entry answers a call, given the call's subject (a command, or serialized input).
 * @param unscriptedReply - The answer for a call no entry matches.
 */
export function createSequencedResponder<Entry extends ScriptedReply>(
  entries: Entry[] | undefined,
  isMatch: (entry: Entry, subject: string) => boolean,
  unscriptedReply: string,
): (subject: string) => string {
  const callCountsByEntry = new Map<Entry, number>();
  return (subject) => {
    const entry = (entries ?? []).find((candidate) => isMatch(candidate, subject));
    if (!entry) return unscriptedReply;
    const callIndex = callCountsByEntry.get(entry) ?? 0;
    callCountsByEntry.set(entry, callIndex + 1);
    return scriptedReplyAt(entry, callIndex);
  };
}

function bashResponseMatches(scripted: ScriptedBashResponse, command: string): boolean {
  return command.includes(scripted.commandContains);
}

function hasPrecedingCommand(scripted: ScriptedBashResponse, answeredCommands: string[]): boolean {
  const after = scripted.afterCommandContains;
  return after === undefined || answeredCommands.some((command) => command.includes(after));
}

function isSpecificEntry(scripted: ScriptedBashResponse | undefined): boolean {
  return scripted !== undefined && scripted.commandContains !== "";
}

/** Each command's first eligible entry, judged after the commands before it in the list ran. */
function firstEligibleEntries(
  commands: string[],
  responses: ScriptedBashResponse[] | undefined,
  answeredCommands: string[],
): (ScriptedBashResponse | undefined)[] {
  const precedingCommands = [...answeredCommands];
  return commands.map((command) => {
    const scripted = (responses ?? []).find(
      (candidate) => bashResponseMatches(candidate, command) && hasPrecedingCommand(candidate, precedingCommands),
    );
    precedingCommands.push(command);
    return scripted;
  });
}

/**
 * Resolve the canned stdout for an intercepted Bash command's first call:
 * `createBashResponder`'s answer to a run's opening command. A first call has
 * no earlier commands, so an entry with `afterCommandContains` answers only a
 * later command in its own chain.
 *
 * A command the scenario never stubs falls through to `UNSCRIPTED_BASH_RESPONSE`,
 * which the agent reads as that command's literal output. A lookup whose real answer
 * is "nothing found" must therefore be stubbed with an empty response — left to the
 * fallback, it reads as a non-empty result and steers the agent down the wrong branch.
 *
 * @param command - The command the agent tried to run.
 * @param responses - The scenario's scripted responses, in declaration order.
 */
export function resolveScriptedBashResponse(
  command: string,
  responses: ScriptedBashResponse[] | undefined,
): string {
  return createBashResponder(responses)(command);
}

/**
 * A run's Bash answerer. First match wins; `commandContains: ""` is the
 * catch-all. Each entry's sequence advances per matching call, and each
 * `afterCommandContains` entry is eligible once an earlier command carried its
 * substring.
 *
 * A chained command (`a && b; c`) is answered command by command, the replies
 * joined by newlines as a shell prints them. A `cd`, an assignment or an `echo`
 * of literals prints what the shell would; a command only the catch-all
 * matches prints nothing. When no command in the chain matches a specific
 * entry, the chain is answered whole.
 */
export function createBashResponder(
  responses: ScriptedBashResponse[] | undefined,
): (command: string) => string {
  const answeredCommands: string[] = [];
  const respond = createSequencedResponder(
    responses,
    (scripted: ScriptedBashResponse, command) =>
      bashResponseMatches(scripted, command) && hasPrecedingCommand(scripted, answeredCommands),
    UNSCRIPTED_BASH_RESPONSE,
  );
  const answer = (command: string): string => {
    const reply = respond(command);
    answeredCommands.push(command);
    return reply;
  };
  return (command) => {
    const chain = chainedCommands(command);
    const commandsInChain = chain.map((chained) => chained.command);
    const builtinOutputs = chain.map((chained) => builtinOutput(chained));
    const entries = firstEligibleEntries(commandsInChain, responses, answeredCommands);
    const isStubbed = chain.map((_, index) => builtinOutputs[index] === undefined && isSpecificEntry(entries[index]));
    if (chain.length < 2 || !isStubbed.includes(true)) return answer(command);
    const replies = commandsInChain.map((chainedCommand, index) => {
      if (isStubbed[index]) return answer(chainedCommand);
      answeredCommands.push(chainedCommand);
      return builtinOutputs[index] ?? "";
    });
    return replies.filter((reply) => reply !== "").join("\n");
  };
}

/**
 * A run's answerer for the scripted tools: each tool answers from its own
 * `toolResponses` entries by `argContains` against the serialized input.
 * Unscripted, AskUserQuestion is told there is no user; every other tool gets
 * `UNSCRIPTED_TOOL_RESPONSE`.
 */
export function createToolResponder(
  toolResponses: ScriptedToolResponses | undefined,
): (tool: ScriptedTool, serializedInput: string) => string {
  const respondersByTool = new Map<ScriptedTool, (serializedInput: string) => string>();
  for (const tool of Object.values(ScriptedTool)) {
    respondersByTool.set(
      tool,
      createSequencedResponder(
        toolResponses?.[tool],
        (entry, serializedInput) => serializedInput.includes(entry.argContains),
        tool === ScriptedTool.AskUserQuestion ? NO_USER_RESPONSE : UNSCRIPTED_TOOL_RESPONSE,
      ),
    );
  }
  return (tool, serializedInput) => respondersByTool.get(tool)!(serializedInput);
}
