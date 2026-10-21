/** How a test case that did not pass ended. */
export enum UnpassedCaseStatus {
  Failed = "failed",
  Inconclusive = "inconclusive",
}

/** One test case whose latest run did not pass. */
export interface IUnpassedCase {
  /** Test case name as the walkthrough shows it. */
  name: string;
  /** Test case id, so a repair can re-run exactly this case. */
  testCaseId: string;
  status: UnpassedCaseStatus;
  /** 1-based position of the failing step; absent for an inconclusive run. */
  failedStep?: number;
  /** The run's error (failed) or reason (inconclusive), trimmed to one line. */
  detail: string;
  /** Dashboard link to the run. */
  viewUrl: string;
}

/**
 * The machine-readable outcome a walkthrough carries alongside its markdown.
 *
 * Output shape: `{ total: 3, passed: 1, unpassed: [{ name, testCaseId, status: "failed", failedStep: 3, detail, viewUrl }] }`
 */
export interface IE2eResultRecord {
  /** Test cases in the run, after repeated runs of one case collapse to the latest. */
  total: number;
  passed: number;
  /** Every failed or inconclusive case, in report order. */
  unpassed: IUnpassedCase[];
}
