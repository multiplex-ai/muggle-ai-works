/**
 * The compact trace a failed run prints, so a CI log shows what the agent did
 * instead of only which expectation it missed.
 */

import { FAILED_RUN_TRACE_ARGS_CHARS, FAILED_RUN_TRACE_MAX_ATTEMPTS } from "./constants.js";
import type { AgentRunVerdict, ToolAttempt } from "./types.js";

function attemptPreview(attempt: ToolAttempt): string {
  const { command, file_path: filePath, content, new_string: newString } = attempt.args as Record<string, unknown>;
  // Lead with what tells calls apart: the command, or the file and what went into it.
  const lead = typeof command === "string" ? command : typeof filePath === "string" ? filePath : "";
  const written = typeof content === "string" ? content : typeof newString === "string" ? newString : "";
  const body = lead ? [lead, written].filter(Boolean).join(" ← ") : JSON.stringify(attempt.args);
  const flattened = body.replace(/\s*\n\s*/g, " ⏎ ");
  return flattened.length > FAILED_RUN_TRACE_ARGS_CHARS
    ? `${flattened.slice(0, FAILED_RUN_TRACE_ARGS_CHARS)}…`
    : flattened;
}

/**
 * The lines a failed run prints: one per tool attempt, latest
 * `FAILED_RUN_TRACE_MAX_ATTEMPTS` only, then the final output's opening.
 * Empty for a passing run or one the SDK aborted before any attempt.
 *
 * Output shape: `["  trace: 42 attempts, last 3 shown", "  #40 Bash cd ~/s && echo \"Stage 2 done — …\" >> iterations/001.md", …, "  final: Tick complete."]`
 */
export function formatFailedRunTrace(verdict: AgentRunVerdict): string[] {
  const attempts = verdict.trace.toolAttempts;
  if (verdict.pass || attempts.length === 0) return [];
  const firstShown = Math.max(0, attempts.length - FAILED_RUN_TRACE_MAX_ATTEMPTS);
  const lines = [`  trace: ${attempts.length} attempts, last ${attempts.length - firstShown} shown`];
  attempts.slice(firstShown).forEach((attempt, offset) => {
    lines.push(`  #${firstShown + offset + 1} ${attempt.tool} ${attemptPreview(attempt)}`);
  });
  const finalOutput = verdict.trace.finalOutput.replace(/\s*\n\s*/g, " ⏎ ");
  if (finalOutput) lines.push(`  final: ${finalOutput.slice(0, FAILED_RUN_TRACE_ARGS_CHARS)}`);
  return lines;
}
