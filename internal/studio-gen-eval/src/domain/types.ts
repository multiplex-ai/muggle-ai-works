// Domain and backend types for the studio generation-reliability eval.

/** Workflow orchestration lifecycle, as returned by the backend. */
export enum WorkflowRunStatus {
  Pending = "PENDING",
  Running = "RUNNING",
  Completed = "COMPLETED",
  Failed = "FAILED",
  Cancelled = "CANCELLED",
  Timeout = "TIMEOUT",
}

/** The studio's own verdict for a run, orthogonal to the workflow status. */
export enum StudioResultStatus {
  Success = "success",
  GoalNotAchievable = "goal_not_achievable",
  Failure = "failure",
  Timeout = "timeout",
}

/** Typed, infrastructure-side failure causes the backend can attach. */
export enum RunFailureReasonType {
  AccountBlocked = "account_blocked",
  InvalidCredentials = "invalid_credentials",
  AccountDisabled = "account_disabled",
}

/**
 * Subset of the backend run payload this tool reads. Upstream responses are
 * untyped passthrough, so every field is optional and parsed defensively.
 */
export interface BackendRunData {
  id?: string;
  workflowRuntimeId?: string;
  status?: WorkflowRunStatus | string;
  error?: string;
  studioReturnedResult?: {
    summary?: string;
    status?: StudioResultStatus | string;
    error?: string;
    failedStepIndex?: number;
    structuredSummary?: {
      failureReason?: string | null;
      failure?: {
        reason?: { text?: string; type?: RunFailureReasonType | string | null };
      } | null;
    };
  };
  taskDef?: { testScript?: { actionScriptId?: string } };
}

/** Handle returned when a generation run is started; poll the run by this id. */
export interface StartedRun {
  runtimeId: string;
}

/** How a single repetition is counted toward (or excluded from) the pass-rate. */
export enum OutcomeClass {
  Pass = "pass",
  Fail = "fail",
  Error = "error",
}

/** Named failure modes rolled up across a batch. */
export enum FailureBucket {
  AccountLockout = "account-lockout",
  InvalidCredentials = "invalid-credentials",
  Timeout = "timeout",
  Crash = "crash",
  ElementIndexDrift = "element-index-drift",
  DatePickerGap = "date-picker-gap",
  SecretInputUnresolved = "secret-input-unresolved",
  ScrollContainerBlindness = "scroll-container-blindness",
  UnclassifiedFail = "unclassified-fail",
}

/** Outcome of classifying one terminal run (or a local timeout). */
export interface RepVerdict {
  outcome: OutcomeClass;
  bucket?: FailureBucket;
  reason?: string;
}

/** A single generation repetition's recorded result. */
export interface RepResult {
  testCaseId: string;
  rep: number;
  outcome: OutcomeClass;
  bucket?: FailureBucket;
  reason?: string;
  runtimeId?: string;
  runId?: string;
  durationMs: number;
}

/** One golden-set entry: the live id plus a frozen, generation-ready snapshot. */
export interface GoldenCase {
  testCaseId: string;
  useCaseId: string;
  projectId: string;
  title: string;
  url: string;
  goal: string;
  precondition: string;
  instructions: string;
  expectedResult: string;
  bodyHash: string;
}

/** The committed golden set, cold-started from one project. */
export interface GoldenSet {
  sourceProjectId: string;
  importedAt: string;
  cases: GoldenCase[];
}

export interface ProjectSummary {
  id: string;
  name: string;
}

/** Test-case fields the backend returns; mapped into a GoldenCase at import. */
export interface TestCaseDetail {
  id: string;
  useCaseId?: string;
  projectId?: string;
  title?: string;
  url?: string;
  goal?: string;
  precondition?: string;
  description?: string;
  instructions?: string;
  expectedResult?: string;
}

/** Inputs the generation workflow requires, sourced from a GoldenCase. */
export interface StartGenerationInput {
  projectId: string;
  useCaseId: string;
  testCaseId: string;
  name: string;
  url: string;
  goal: string;
  precondition: string;
  instructions: string;
  expectedResult: string;
  workflowParams?: Record<string, unknown>;
}

/**
 * The backend seam. The orchestrator and import depend only on this interface,
 * so they unit-test against a mock and the real client stays the single place
 * coupled to upstream shapes and auth.
 */
export interface BackendClient {
  listProjects(): Promise<ProjectSummary[]>;
  listTestCasesByProject(projectId: string): Promise<TestCaseDetail[]>;
  getTestCase(testCaseId: string): Promise<TestCaseDetail>;
  startGeneration(input: StartGenerationInput): Promise<StartedRun>;
  getLatestRun(runtimeId: string): Promise<BackendRunData | null>;
  cancelRuntime(runtimeId: string): Promise<void>;
}

/** Knobs for one batch run. */
export interface BatchConfig {
  runs: number;
  concurrency: number;
  repTimeoutMs: number;
  flags: Record<string, string | boolean>;
  caseFilter?: string[];
  dryRun: boolean;
}

/** Per-case rollup. */
export interface CaseSummary {
  testCaseId: string;
  title: string;
  reps: number;
  passes: number;
  fails: number;
  errors: number;
  passRate: number;
  buckets: Record<string, number>;
}

/** Whole-batch report persisted to disk. */
export interface BatchReport {
  batchId: string;
  recordedAt: string;
  sourceProjectId: string;
  runsPerCase: number;
  flags: Record<string, string | boolean>;
  overallPassRate: number;
  scoredReps: number;
  infraErrors: number;
  buckets: Record<string, number>;
  cases: CaseSummary[];
  reps: RepResult[];
}
