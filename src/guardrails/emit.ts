export type Host = "claude" | "cursor";

export function envelope(eventName: string, context: string, host: Host): string {
  if (!context) return "{}";
  if (host === "cursor") return JSON.stringify({ additional_context: context });
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: eventName, additionalContext: context },
  });
}
