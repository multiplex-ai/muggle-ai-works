/**
 * Runs one agent scenario end-to-end and returns a per-run verdict.
 *
 * Mechanics:
 *   - Loads the agent's `plugin/agents/<name>.md` body as the system prompt —
 *     the same text the harness applies in production — plus an environment
 *     note describing the sandbox.
 *   - Runs on the model the agent's frontmatter pins (resolved upstream); the
 *     pin surviving on a cheaper/different model IS the contract under test.
 *   - Read is real and scoped to the plugin tree (the agent definition's
 *     grandparent dir), so the stage files the agent links to must actually
 *     resolve — a broken link fails behaviorally. The rest of the repo is
 *     denied: a single Read of a lockfile-sized file overflows the run's
 *     context and trips the SDK's autocompact-thrash breaker.
 *   - Bash is intercepted: every call is denied with the scenario's scripted
 *     output for that command, so the run is hermetic (nothing executes) while
 *     the agent still "observes" ports, smoke results, and CLI output.
 *   - AskUserQuestion is denied and counted; the verdict fails any run that
 *     asks — agents return `needs-input:` instead of asking.
 */

import * as path from "node:path";

import {
  query,
  type CanUseTool,
  type PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";

import { ASK_QUESTION_TOOL } from "../../skill-gate-eval/src/constants.js";
import type { AgentRunOptions, AgentRunVerdict, ToolAttempt } from "./types.js";
import { judgeAgentRun } from "./verdict.js";

const DEFAULT_MAX_TURNS = 60;

function buildSystemPrompt(opts: AgentRunOptions): string {
  return [
    opts.definition.body,
    "",
    "---",
    "# ENVIRONMENT NOTE (behavioral test harness)",
    `Your definition file lives at ${opts.definition.filePath}; resolve its`,
    "relative markdown links from that location using the Read tool.",
    "",
    "Bash commands do not execute here. Every Bash call is intercepted and the",
    "permission message carries that command's REAL observed output for this",
    "environment (marked SIMULATED OUTPUT). Treat it exactly as if the command",
    "ran and printed it; do not re-run a command whose output you already have.",
    "",
    "There is no user. Follow your no-user-channel contract: a missing decision",
    "or input means returning a single `needs-input:` line, never a question.",
  ].join("\n");
}

function scriptedBashResponse(command: string, opts: AgentRunOptions): string {
  for (const scripted of opts.scenario.bashResponses ?? []) {
    if (command.includes(scripted.commandContains)) return scripted.response;
  }
  return "(exit 0, no output)";
}

/** Run one scenario once and return a verdict. Caller invokes this N times to compute a pass rate. */
export async function runAgentScenarioOnce(
  opts: AgentRunOptions,
  onMessage?: (msg: unknown) => void,
): Promise<AgentRunVerdict> {
  const toolAttempts: ToolAttempt[] = [];
  let askQuestionCount = 0;

  const readRoot = path.dirname(
    path.dirname(path.resolve(opts.definition.filePath)),
  );

  const canUseTool: CanUseTool = async (
    toolName,
    input,
  ): Promise<PermissionResult> => {
    toolAttempts.push({ tool: toolName, args: input });

    if (toolName === ASK_QUESTION_TOOL) {
      askQuestionCount++;
      return {
        behavior: "deny",
        message:
          "[harness] there is no user in this environment — return a `needs-input:` line instead of asking",
      };
    }

    if (toolName === "Read") {
      const filePath = (input as { file_path?: unknown }).file_path;
      const resolved = typeof filePath === "string" ? path.resolve(filePath) : "";
      if (resolved === readRoot || resolved.startsWith(readRoot + path.sep)) {
        return { behavior: "allow", updatedInput: input };
      }
      return {
        behavior: "deny",
        message: `[harness] Read is limited to the plugin tree at ${readRoot}; everything else in this environment is observed through the scripted Bash outputs`,
      };
    }

    if (toolName === "Bash") {
      const command = String((input as { command?: unknown }).command ?? "");
      return {
        behavior: "deny",
        message: `SIMULATED OUTPUT (treat as the command's real result):\n${scriptedBashResponse(command, opts)}`,
      };
    }

    return {
      behavior: "deny",
      message: `[harness] tool ${toolName} is not available in this eval`,
    };
  };

  const stream = query({
    prompt: opts.scenario.prompt,
    options: {
      systemPrompt: buildSystemPrompt(opts),
      canUseTool: canUseTool,
      model: opts.definition.model,
      maxTurns: opts.maxTurns ?? DEFAULT_MAX_TURNS,
      tools: ["Read", "Bash", "AskUserQuestion"],
      ...(process.env.CLAUDE_CODE_EXECUTABLE
        ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE }
        : {}),
      stderr: (data: string) => process.stderr.write(data),
    },
  });

  // Drain the stream; the terminal `result` message carries the agent's final
  // report. Keep the last assistant text as a fallback when the run ends
  // without a success result (e.g. max-turns).
  let finalOutput = "";
  let lastAssistantText = "";
  let lastResult: unknown = null;
  try {
    for await (const msg of stream) {
      if (onMessage) onMessage(msg);
      const typed = msg as {
        type?: string;
        result?: unknown;
        message?: { content?: Array<{ type?: string; text?: string }> };
      };
      if (typed.type === "result") {
        lastResult = msg;
        if (typeof typed.result === "string") finalOutput = typed.result;
      }
      if (typed.type === "assistant") {
        const textBlocks = (typed.message?.content ?? [])
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string);
        if (textBlocks.length > 0) lastAssistantText = textBlocks.join("\n");
      }
    }
  } catch (err) {
    if (lastResult !== null) {
      process.stderr.write(
        `[agent-gate-eval] final SDK message before failure: ${JSON.stringify(lastResult)}\n`,
      );
    }
    throw err;
  }

  if (!finalOutput) finalOutput = lastAssistantText;

  return judgeAgentRun(opts.scenario, finalOutput, toolAttempts, askQuestionCount);
}
