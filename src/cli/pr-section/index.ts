/**
 * Public API for the PR-body evidence block builder.
 *
 * `buildPrSection(report, opts)` is the single entry point for both the
 * `muggle build-pr-section` CLI handler and any in-process caller.
 */

import { splitWithOverflow, type ISplitOptions, type ISplitResult } from "./overflow.js";
import type { E2eReport } from "./types.js";

export { E2eReportSchema } from "./types.js";
export type { E2eReport, TestResult, PassedTest, FailedTest, Step } from "./types.js";
export type { ISplitOptions, ISplitResult } from "./overflow.js";

/**
 * Render a PR-body evidence block and (optionally) an overflow comment from an
 * e2e-acceptance report.
 */
export function buildPrSection (report: E2eReport, opts: ISplitOptions): ISplitResult {
  return splitWithOverflow(report, opts);
}
