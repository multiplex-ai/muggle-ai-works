import type { IosRunStatusEnum, IosRunVerdictEnum } from "../../e2e/contracts/ios-pool-types.js";

/** One run as the pool's `{ run }` body carries it: immutable record, machinery state, published result. */
export interface IRawIosRunView {
  record?: {
    runId?: string;
    createdAtMs?: number;
    request?: {
      projectId?: string;
      artifactDigest?: string;
      task?: string;
      useCaseId?: string;
      testCaseId?: string;
      deviceType?: string;
    };
  };
  state?: {
    status?: IosRunStatusEnum;
    attemptCount?: number;
    maxAttempts?: number;
    cancelRequested?: boolean;
    statusUpdatedAtMs?: number;
  };
  result?: {
    verdict?: IosRunVerdictEnum;
    summary?: string;
    evidence?: string;
    stepCount?: number;
  } | null;
}

/** Body of `POST /ios-pool/runs` and `GET /ios-pool/runs/:runId`. */
export interface IRawIosRunEnvelope {
  run?: IRawIosRunView;
}

/** One iOS run as muggle-remote-ios-run-create and -get return it. */
export interface IIosRunSummary {
  runId: string;
  projectId: string;
  artifactDigest: string;
  deviceType: string;
  task?: string;
  useCaseId?: string;
  testCaseId?: string;
  /** Machinery status: whether the pool finished running it, never whether the app passed. */
  status: IosRunStatusEnum;
  /** True once the status can no longer change, so polling can stop. */
  isFinished: boolean;
  /** Test outcome; null until the host publishes a result, and always null for a run that never completed. */
  verdict: IosRunVerdictEnum | null;
  summary?: string;
  evidence?: string;
  stepCount?: number;
  attemptCount?: number;
  maxAttempts?: number;
  createdAtMs?: number;
  statusUpdatedAtMs?: number;
}

/** Output of muggle-remote-ios-run-create and -get. */
export interface IIosRunOutput {
  run: IIosRunSummary;
}
