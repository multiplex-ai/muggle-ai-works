import { homedir } from "os";
import { defaultSkipProbes } from "../e2e-skip/probes.js";
import { resolveSkipDeclaration } from "../e2e-skip/resolveSkip.js";
import type { SkipJudgment, SkipProbes } from "../e2e-skip/types.js";
import type { GuardrailState, HookInput } from "./types.js";

/**
 * Judge a tool call as an E2E skip declaration, holding any cited code to its
 * precondition.
 *
 * `null` when the call was not a declaration; a rejected judgment when one was
 * attempted and did not qualify. The two differ for the caller: only the second
 * owes the session an explanation, and neither records a skip.
 */
export function judgeE2eSkip(
  input: HookInput,
  state: GuardrailState,
  probes: SkipProbes = defaultSkipProbes,
): SkipJudgment | null {
  return resolveSkipDeclaration(input.tool_input?.command ?? "", {
    cwd: input.cwd,
    prsHandled: state.prsHandled,
    transcriptPath: input.transcript_path,
    homeDir: homedir(),
    probe: probes,
  });
}
