import { BenchmarkOutcome, type TaskResult } from "../domain/types";
import { ERROR_CLASS_PATTERNS, ERROR_CLASS_PREFIX, UNRECOGNISED_ERROR_CLASS } from "./constants";

/**
 * The failure class of one attempt: its outcome for a judged failure or a block, and the error's
 * kind for an infrastructure error. A pass has none.
 *
 * Output shape: `"fail"`, `"blocked"`, `"error:timeout"`, `"error:exit-3"`, or `undefined`
 */
export const classifyFailure = (result: TaskResult): string | undefined => {
  if (result.outcome === BenchmarkOutcome.Pass) return undefined;
  if (result.outcome !== BenchmarkOutcome.Error) return result.outcome;

  const errorReason = result.errorReason ?? "";
  for (const errorClassPattern of ERROR_CLASS_PATTERNS) {
    const match = errorClassPattern.pattern.exec(errorReason);
    if (match) {
      return `${ERROR_CLASS_PREFIX}:${errorClassPattern.label.replace("$1", match[1] ?? "")}`;
    }
  }
  return `${ERROR_CLASS_PREFIX}:${UNRECOGNISED_ERROR_CLASS}`;
};
