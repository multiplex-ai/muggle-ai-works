import { USAGE_LIMIT_SIGNATURE } from "./constants.js";
import type { RunVerdict } from "./types.js";

/**
 * Whether an SDK error is the account's usage allowance running out. Such a rep says nothing about the
 * target, so it is counted as no result; it is not retried, because the allowance resets hours later.
 */
export function isUsageLimitError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return USAGE_LIMIT_SIGNATURE.test(text);
}

/**
 * The usage limit an SDK terminal result reports, as an error. The SDK can end a run on such a result
 * without throwing, which would leave an empty trace to be judged as the gate failing.
 *
 * @returns null for a result that is not an error, or is an error of another kind.
 */
export function usageLimitErrorFromResult(terminalResult: unknown): Error | null {
  if (!(terminalResult as { is_error?: unknown } | null)?.is_error) return null;
  const resultText = JSON.stringify(terminalResult);
  return isUsageLimitError(resultText) ? new Error(resultText) : null;
}

/**
 * The no-result verdict for a rep a usage limit stopped.
 *
 * @throws `error` itself when it is not a usage limit.
 */
export function usageLimitVerdict(scenarioName: string, error: unknown): RunVerdict {
  if (!isUsageLimitError(error)) throw error;
  return {
    scenario: scenarioName,
    pass: false,
    reasons: [`run aborted by SDK error: ${String(error).slice(0, 300)}`],
    trace: { mcpCalls: [], askQuestions: [] },
    isInconclusive: true,
  };
}
