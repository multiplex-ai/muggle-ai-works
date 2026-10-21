import type { HookInput } from "./types.js";

/**
 * The hook payload in the one shape every guardrail reads.
 *
 * Codex reports a shell call's result as the bare output string, where Claude
 * Code sends `{ stdout, stderr }`, so a detector reading `tool_response.stdout`
 * was dead code on Codex. The string becomes `{ output }` — the field the
 * detectors already read for hosts that report combined output. Anything that
 * is not a JSON object is no payload at all.
 */
export function normalizeHookInput(raw: unknown): HookInput {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const payload = raw as Omit<HookInput, "tool_response"> & { tool_response?: unknown };
  if (typeof payload.tool_response === "string") {
    return { ...payload, tool_response: { output: payload.tool_response } };
  }
  return payload as HookInput;
}
