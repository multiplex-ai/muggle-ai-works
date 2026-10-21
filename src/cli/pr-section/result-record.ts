import { UNPASSED_DETAIL_MAX_CHARS } from "../../e2e-result/constants.js";
import { UnpassedCaseStatus, type IE2eResultRecord, type IUnpassedCase } from "../../e2e-result/types.js";
import type { TestResult } from "./types.js";

/**
 * Position of the failing step in `steps[]`, 1-based.
 *
 * Producers disagree on whether `stepIndex` counts from 0 or 1, so the ordinal
 * comes from the step's place in the array — the same basis as the rendered step
 * list and the step count. Falls back to the raw index when no step carries it.
 */
export function failureOrdinal (test: TestResult, failureStepIndex: number): number {
  const position = test.steps.findIndex((s) => s.stepIndex === failureStepIndex);
  return position === -1 ? failureStepIndex : position + 1;
}

/** One line of free text, cut to the record's per-case budget. */
function oneLineDetail (text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > UNPASSED_DETAIL_MAX_CHARS ? `${flat.slice(0, UNPASSED_DETAIL_MAX_CHARS - 1)}…` : flat;
}

function toUnpassedCase (test: TestResult): IUnpassedCase | null {
  if (test.status === "failed") {
    return {
      name: test.name,
      testCaseId: test.testCaseId,
      status: UnpassedCaseStatus.Failed,
      failedStep: failureOrdinal(test, test.failureStepIndex),
      detail: oneLineDetail(test.error),
      viewUrl: test.viewUrl,
    };
  }
  if (test.status === "inconclusive") {
    return {
      name: test.name,
      testCaseId: test.testCaseId,
      status: UnpassedCaseStatus.Inconclusive,
      detail: oneLineDetail(test.reason),
      viewUrl: test.viewUrl,
    };
  }
  return null;
}

/**
 * Reduce a report's latest runs to the record its walkthrough carries.
 *
 * @param latestTests - One entry per test case, already collapsed to its latest run.
 */
export function buildE2eResultRecord (latestTests: readonly TestResult[]): IE2eResultRecord {
  const unpassed = latestTests
    .map(toUnpassedCase)
    .filter((entry): entry is IUnpassedCase => entry !== null);
  return {
    total: latestTests.length,
    passed: latestTests.filter((test) => test.status === "passed").length,
    unpassed: unpassed,
  };
}
