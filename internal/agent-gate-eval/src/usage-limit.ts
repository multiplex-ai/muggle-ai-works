import { USAGE_LIMIT_SIGNATURE } from "./constants.js";

/**
 * Whether an SDK error is the account's usage allowance running out. Such a rep says nothing about the
 * target, so it is counted as no result; it is not retried, because the allowance resets hours later.
 */
export function isUsageLimitError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return USAGE_LIMIT_SIGNATURE.test(text);
}
