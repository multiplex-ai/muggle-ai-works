import { MERGED_GATE_OUTPUT_SEPARATOR } from "./constants.js";
import type { GuardrailHookOutput } from "./types.js";

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

/**
 * Folds the responses of every gate that fired on one event into the single response one hook
 * command returns, matching how the harness combined them when each gate was its own hook: any
 * PreToolUse deny wins, then any Stop block, otherwise context is concatenated.
 *
 * Output shape: `{"decision":"block","reason":"<gate A reason>\n\n<gate B reason>"}`
 */
export function mergeHookOutputs(gateOutputs: string[], host: Host): string {
  const parsedOutputs = gateOutputs.flatMap((gateOutput): GuardrailHookOutput[] => {
    try {
      return [JSON.parse(gateOutput) as GuardrailHookOutput];
    } catch {
      return [];
    }
  });
  const denyReasons = parsedOutputs
    .filter((parsed) => parsed.hookSpecificOutput?.permissionDecision === "deny")
    .map((parsed) => parsed.hookSpecificOutput?.permissionDecisionReason ?? "")
    .filter(Boolean);
  if (denyReasons.length > 0) return denyTool(denyReasons.join(MERGED_GATE_OUTPUT_SEPARATOR), host);
  const blockReasons = parsedOutputs
    .filter((parsed) => parsed.decision === "block")
    .map((parsed) => parsed.reason ?? "")
    .filter(Boolean);
  if (blockReasons.length > 0) return blockStop(blockReasons.join(MERGED_GATE_OUTPUT_SEPARATOR), host);
  const contexts = parsedOutputs
    .map((parsed) => parsed.hookSpecificOutput?.additionalContext ?? parsed.additional_context ?? "")
    .filter(Boolean);
  if (contexts.length === 0) return "{}";
  const hookEventName = parsedOutputs.find((parsed) => parsed.hookSpecificOutput?.hookEventName)
    ?.hookSpecificOutput?.hookEventName;
  return envelope(hookEventName ?? "", contexts.join(MERGED_GATE_OUTPUT_SEPARATOR), host);
}
