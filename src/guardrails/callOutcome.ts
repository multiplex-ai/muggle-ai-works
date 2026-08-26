import { CALL_FAILURE_SIGNALS } from "./constants.js";
import type { HookInput } from "./types.js";

// Flattened because a tool response's shape is decided by the host: a string on
// one, an array of typed parts on another, sometimes wrapped again. Reading one
// assumed field is how a check becomes dead code on the host that nests it
// differently.
function renderedResponse(toolResponse: unknown): string {
  const rendered: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") rendered.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(toolResponse);
  return rendered.join("\n");
}

/**
 * Whether a tool call visibly failed.
 *
 * Recorders that clear an obligation — a walkthrough posted, a failure
 * diagnosed, a test case classified — used to record from the request alone, so
 * a call the provider rejected still settled the thing it was supposed to
 * prove. A rejected `gh pr comment` marked the walkthrough posted and the gate
 * went quiet on a PR that never received it.
 *
 * This asks the weaker question — did the call *visibly* fail — rather than
 * whether it positively succeeded. Success shapes differ per tool and several
 * live outside this repo, so a positive check would go stale silently; a
 * response with no failure signal is recorded exactly as it is today, and only
 * an observable failure is withheld. That makes this strictly safer than the
 * current behaviour and unable to over-block.
 *
 * The signals are anchored tightly on purpose: a walkthrough body legitimately
 * contains the words "error" and "failed", and `gh api` echoes that body back
 * in its response.
 */
export function callFailed(input: HookInput): boolean {
  const rendered = renderedResponse(input.tool_response);
  return CALL_FAILURE_SIGNALS.some((signal) => signal.test(rendered));
}
