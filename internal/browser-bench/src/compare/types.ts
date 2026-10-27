import { type ModelSource } from "../domain/types";

/** Flags `compare.ts` accepts on the command line. */
export enum CompareCliFlag {
  Baseline = "--baseline",
  Candidate = "--candidate",
}

/** The two finished batches a comparison reads, each a `run.ts --out` directory. */
export interface CompareCliOptions {
  baselineDir: string;
  candidateDir: string;
}

/** One batch's figures over the tasks both batches ran. */
export interface BatchParFigures {
  modelSource: ModelSource;
  scoredCount: number;
  passRate: number;
  /** Absent when no scored attempt took a step. */
  medianStepMs?: number;
  failureClasses: string[];
}

/** Whether the candidate source performs on par with the baseline, and why not when it does not. */
export interface SourceParVerdict {
  baseline: BatchParFigures;
  candidate: BatchParFigures;
  taskCount: number;
  /** Candidate median step time over the baseline's; absent when either median is. */
  stepTimeRatio?: number;
  /** Candidate pass rate minus the baseline's, in percentage points. */
  passRateDeltaPoints: number;
  /** Failure classes the candidate shows that the baseline never did. */
  newFailureClasses: string[];
  isPar: boolean;
  /** One line per bar the candidate missed; empty when it is on par. */
  missedBars: string[];
}

/** Maps an infrastructure error's message to a stable class; `$1` in `label` takes the first capture. */
export interface ErrorClassPattern {
  pattern: RegExp;
  label: string;
}
