import { E2E_SKIP_CODES, E2E_SKIP_CODE_CLAIMS } from "./constants.js";
import { judgeSkipDeclaration } from "./parseSkipDeclaration.js";
import { SkipRejection, type SkipJudgment, type SkipVerificationContext } from "./types.js";
import { verifyDeclaredSkip } from "./verifySkipCode.js";

/**
 * Judge a command as a skip declaration and, when it cites a real code, hold it
 * to that code's precondition.
 *
 * `null` means the command was not a declaration. A rejected judgment means one
 * was attempted and did not qualify, which must leave the gate blocked.
 */
export function resolveSkipDeclaration(
  cmd: string,
  context: SkipVerificationContext,
): SkipJudgment | null {
  const judged = judgeSkipDeclaration(cmd);
  if (!judged || !judged.accepted) return judged;
  const checked = verifyDeclaredSkip(judged.skip, context);
  if (checked.verified) return judged;
  return {
    accepted: false,
    rejection: SkipRejection.VerificationFailed,
    claimedCode: judged.skip.code,
    failure: checked.failure,
  };
}

const codeMenu = (): string =>
  E2E_SKIP_CODES.map((code) => `${code} (${E2E_SKIP_CODE_CLAIMS[code]})`).join(", ");

/**
 * What to tell the session when a declaration did not qualify.
 *
 * Names the failed check rather than restating the rule, so the next attempt
 * cites a code that actually fits instead of rewording the prose.
 */
export function explainRejection(judged: Extract<SkipJudgment, { accepted: false }>): string {
  if (judged.rejection === SkipRejection.MissingCode) {
    return `That skip declaration states no code. E2E is skipped only by citing one of: ${codeMenu()}.`;
  }
  if (judged.rejection === SkipRejection.UnknownCode) {
    return (
      `"${judged.claimedCode}" is not a skip code, so E2E is still owed. ` +
      `A skip must name a fact about the environment, not a judgment about the change: ${codeMenu()}. ` +
      `If none of them is true, the run has to happen.`
    );
  }
  return (
    `The skip cited ${judged.claimedCode}, but that could not be verified: ${judged.failure}. ` +
    `E2E is still owed — cite a code that holds, or run it.`
  );
}
