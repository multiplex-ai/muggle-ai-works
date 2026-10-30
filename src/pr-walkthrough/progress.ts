import { hasRerunNotice } from "./comment.js";
import {
  PROGRESS_SECTION,
  PROGRESS_STATE_OPENING,
  PROGRESS_STATE_TAG,
  PROGRESS_STATUS_LABELS,
} from "./constants.js";
import { E2eProgressStatus, type E2eProgressCase } from "./types.js";

// A title is free text and the state lives inside an HTML comment, so a `--`
// in it would end the comment early; `-` is the same character to JSON.
const encodeState = (cases: E2eProgressCase[]): string => JSON.stringify(cases).replace(/--/g, "-\\u002d");

// Pipes split a table cell and newlines end the row.
const tableCell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

const isProgressCase = (value: unknown): value is E2eProgressCase => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<E2eProgressCase>;
  return (
    typeof candidate.testCaseId === "string" &&
    typeof candidate.title === "string" &&
    Object.values(E2eProgressStatus).includes(candidate.status as E2eProgressStatus)
  );
};

function renderResultCell(progressCase: E2eProgressCase): string {
  const label = PROGRESS_STATUS_LABELS[progressCase.status];
  return progressCase.viewUrl ? `[${label}](${progressCase.viewUrl})` : label;
}

/** The progress section — state tag, headline, and one table row per test case — in plan order. */
export function renderProgressSection(cases: E2eProgressCase[]): string {
  const finishedCount = cases.filter((progressCase) => progressCase.status !== E2eProgressStatus.Queued).length;
  const rows = cases.map((progressCase) => `| ${tableCell(progressCase.title)} | ${renderResultCell(progressCase)} |`);
  return [
    `${PROGRESS_STATE_OPENING}${encodeState(cases)} -->`,
    `**E2E tests — ${finishedCount} of ${cases.length} finished**`,
    "",
    "| Test case | Result |",
    "| :--- | :--- |",
    ...rows,
  ].join("\n");
}

/** One progress case from its JSON encoding; `undefined` when absent or not a case. */
export function parseProgressCase(encoded: string | undefined): E2eProgressCase | undefined {
  if (!encoded) return undefined;
  try {
    const parsed: unknown = JSON.parse(encoded);
    return isProgressCase(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The test cases a designated comment's progress section records; empty when it has none or it cannot be read. */
export function readProgressCases(body: string): E2eProgressCase[] {
  const encoded = PROGRESS_STATE_TAG.exec(body)?.[1];
  if (!encoded) return [];
  try {
    const parsed: unknown = JSON.parse(encoded);
    return Array.isArray(parsed) ? parsed.filter(isProgressCase) : [];
  } catch {
    return [];
  }
}

/**
 * The designated comment with its progress section replaced by one for `cases`.
 *
 * The section sits inside the in-progress banner, so the walkthrough the run
 * posts replaces it along with the banner, and every reader that classifies the
 * comment by its banner sees it unchanged.
 *
 * @returns `null` when the comment carries no banner — no run is in flight.
 */
export function withProgressSection(body: string, cases: E2eProgressCase[]): string | null {
  if (!hasRerunNotice(body)) return null;
  const section = cases.length > 0 ? `\n\n${renderProgressSection(cases)}\n` : "\n";
  return body.replace(PROGRESS_SECTION, section);
}

/**
 * The case list with one finished run recorded: its planned row updated in
 * place, or a new row appended for a case the plan did not name — a
 * prerequisite generated on the way, or a run started without a plan.
 */
export function withFinishedCase(cases: E2eProgressCase[], finished: E2eProgressCase): E2eProgressCase[] {
  const plannedIndex = cases.findIndex((progressCase) => progressCase.testCaseId === finished.testCaseId);
  if (plannedIndex === -1) return [...cases, finished];
  const planned = cases[plannedIndex];
  return cases.map((progressCase, index) =>
    index === plannedIndex ? { ...finished, title: planned.title || finished.title } : progressCase,
  );
}
