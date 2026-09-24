import { E2E_SKIP_CODES, E2E_SKIP_DECLARATION, SKIP_CODE_TOKEN } from "./constants.js";
import { E2eSkipCode, SkipRejection, type SkipJudgment } from "./types.js";

const stripQuotes = (text: string): string => text.replace(/["']\s*$/, "").trim();

const asSkipCode = (candidate: string): E2eSkipCode | null => {
  const upper = candidate.toUpperCase();
  return E2E_SKIP_CODES.find((code) => code === upper) ?? null;
};

/**
 * Judge a shell command as an E2E skip declaration.
 *
 * Returns `null` when the command is not a declaration at all, so callers can
 * tell "not a skip" from "a skip that does not qualify" — the second must keep
 * the Stop gate blocked, and the first must leave every other guard alone.
 *
 * Output shape: `null`, `{ accepted: true, skip }`, or
 * `{ accepted: false, rejection, claimedCode? }`.
 */
export function judgeSkipDeclaration(cmd: string): SkipJudgment | null {
  const declared = cmd.match(E2E_SKIP_DECLARATION);
  if (!declared) return null;

  const stated = stripQuotes(declared[1] ?? "");
  if (!stated) return { accepted: false, rejection: SkipRejection.MissingCode };

  const token = stated.match(SKIP_CODE_TOKEN)?.[1];
  if (!token) return { accepted: false, rejection: SkipRejection.MissingCode };

  const code = asSkipCode(token);
  if (!code) return { accepted: false, rejection: SkipRejection.UnknownCode, claimedCode: token };

  const detail = stated.slice(stated.indexOf(token) + token.length).replace(/^[\s:]+/, "").trim();
  return { accepted: true, skip: { code: code, detail: detail } };
}
