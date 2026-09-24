const MONTH_NAMES =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";

/** Characters of day-and-range text tolerated between a month name and its year, as in "March 20-27, 2024". */
const MONTH_TO_YEAR_GAP = 24;

const ISO_DATE_PATTERN = /\b((?:19|20)\d{2})-\d{2}-\d{2}\b/g;
const MONTH_AND_YEAR_PATTERN = new RegExp(
  `\\b(?:${MONTH_NAMES})\\b[^.!?]{0,${MONTH_TO_YEAR_GAP}}?\\b((?:19|20)\\d{2})\\b`,
  "gi",
);

/**
 * Years an instruction pins a date to that were already over when the run happened.
 *
 * A year counts only when it sits beside a month or inside an ISO date, so a bare
 * figure such as "2024 stars" is not read as one. A month and day carrying no year —
 * "Dec. 26th" — is never past-dated: it resolves to the next occurrence, which is how
 * a person reading the task would take it.
 *
 * Whether a past date makes the task unanswerable is the site's business, not this
 * function's. An archive search over October 2023 is perfectly satisfiable; a hotel
 * booking for March 2024 cannot be made at any price. Reporting the fact and leaving
 * that judgement to the reader is the part that generalises.
 *
 * Output shape: `[2024]` for "a stay from March 20-27, 2024".
 * @param instruction - The task instruction as written.
 * @param runYear - The calendar year the attempt ran in.
 * @returns Each distinct past year the instruction names, ascending; empty when none.
 */
export const findPastDatedYears = (instruction: string, runYear: number): number[] => {
  const years = new Set<number>();

  for (const pattern of [ISO_DATE_PATTERN, MONTH_AND_YEAR_PATTERN]) {
    for (const match of instruction.matchAll(pattern)) {
      const year = Number.parseInt(match[1], 10);
      if (year < runYear) years.add(year);
    }
  }

  return [...years].sort((left, right) => left - right);
};
