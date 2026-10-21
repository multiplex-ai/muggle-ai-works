/**
 * Records a run's tool attempts from the model's own `tool_use` blocks, the
 * one record every call leaves — including calls the SDK rejects before any
 * hook or permission check sees them, such as a Read with a relative path.
 */

import { HOST_STUB_PREFIX, MOCK_MCP_PREFIX } from "../constants.js";
import type { ToolAttempt } from "../types.js";

/** The name scenarios use for a tool: a mock muggle or host-stub call loses its server prefix. */
export function scenarioToolName(toolName: string): string {
  for (const prefix of [MOCK_MCP_PREFIX, HOST_STUB_PREFIX]) {
    if (toolName.startsWith(prefix)) return toolName.slice(prefix.length);
  }
  return toolName;
}

/**
 * The tool attempts one SDK stream message carries, in call order: the
 * `tool_use` blocks of a main-thread assistant message, or none.
 *
 * Output shape: `[{ tool: "Bash", args: { command: "gh pr view 7" } }, { tool: "Skill", args: { skill: "muggle-test-prepare" } }]`
 */
export function toolAttemptsInMessage(message: unknown): ToolAttempt[] {
  const typed = message as {
    type?: string;
    parent_tool_use_id?: string | null;
    message?: { content?: Array<{ type?: string; name?: string; input?: unknown }> };
  };
  if (typed.type !== "assistant" || typed.parent_tool_use_id) return [];
  return (typed.message?.content ?? [])
    .filter((block) => block.type === "tool_use" && typeof block.name === "string")
    .map((block) => ({
      tool: scenarioToolName(block.name as string),
      args: (block.input ?? {}) as Record<string, unknown>,
    }));
}
