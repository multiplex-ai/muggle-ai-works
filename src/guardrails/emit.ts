export type Host = "claude" | "cursor";

export function envelope(eventName: string, context: string, host: Host): string {
  if (!context) return "{}";
  if (host === "cursor") return JSON.stringify({ additional_context: context });
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context },
  });
}

// Stop hook: refuse to end the turn. Claude honours `decision: "block"` and feeds
// `reason` back to the model as the instruction to keep going. Cursor has no block
// primitive, so it degrades to an advisory the model can still ignore.
export function blockStop(reason: string, host: Host): string {
  if (!reason) return "{}";
  if (host === "cursor") return JSON.stringify({ additional_context: reason });
  return JSON.stringify({ decision: "block", reason: reason });
}

// PreToolUse hook: refuse a tool call before it runs. Claude honours
// `permissionDecision: "deny"`; cursor degrades to an advisory.
export function denyTool(reason: string, host: Host): string {
  if (!reason) return "{}";
  if (host === "cursor") return JSON.stringify({ additional_context: reason });
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  });
}
