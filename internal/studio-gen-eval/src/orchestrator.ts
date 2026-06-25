import { POLL_INTERVAL_MS } from "./constants.js";
import { classifyRun, isTerminal } from "./scorer.js";
import {
  type BackendClient,
  type BackendRunData,
  type BatchConfig,
  FailureBucket,
  type GoldenCase,
  type GoldenSet,
  OutcomeClass,
  type RepResult,
  type StartGenerationInput,
} from "./types.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Hooks let the caller persist each rep incrementally and skip already-done reps on resume. */
export interface BatchHooks {
  skip?: (testCaseId: string, rep: number) => boolean;
  onRepDone?: (rep: RepResult) => void;
}

function buildInput (c: GoldenCase, flags: Record<string, string | boolean>): StartGenerationInput {
  const input: StartGenerationInput = {
    projectId: c.projectId,
    useCaseId: c.useCaseId,
    testCaseId: c.testCaseId,
    name: `[gen-eval] ${c.title}`,
    url: c.url,
    goal: c.goal,
    precondition: c.precondition,
    instructions: c.instructions,
    expectedResult: c.expectedResult,
  };
  if (Object.keys(flags).length > 0) input.workflowParams = { featureFlags: flags };
  return input;
}

/** Map a transport/HTTP error message to an infra bucket so it's excluded from the pass-rate. */
function transportBucket (message: string): FailureBucket {
  const m = message.toLowerCase();
  if (m.includes("429") || m.includes("too many") || m.includes("rate limit") || m.includes("lock") || m.includes("blocked")) {
    return FailureBucket.AccountLockout;
  }
  if (m.includes("401") || m.includes("unauthor") || m.includes("invalid bearer") || m.includes("credential")) {
    return FailureBucket.InvalidCredentials;
  }
  if (m.includes("timeout") || m.includes("etimedout") || m.includes("econnreset") || m.includes("network")) {
    return FailureBucket.Timeout;
  }
  return FailureBucket.Crash;
}

async function pollToTerminal (
  client: BackendClient,
  runtimeId: string,
  timeoutMs: number,
): Promise<BackendRunData | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await client.getLatestRun(runtimeId);
    if (run !== null) {
      const status = typeof run.status === "string" ? run.status : undefined;
      if (isTerminal(status) || run.studioReturnedResult?.status) return run;
    }
    if (Date.now() >= deadline) return "timeout";
    await sleep(POLL_INTERVAL_MS);
  }
}

async function runOne (client: BackendClient, c: GoldenCase, rep: number, config: BatchConfig): Promise<RepResult> {
  const started = Date.now();
  let runtimeId: string | undefined;
  try {
    const startResult = await client.startGeneration(buildInput(c, config.flags));
    runtimeId = startResult.runtimeId;
    const polled = await pollToTerminal(client, runtimeId, config.repTimeoutMs);
    if (polled === "timeout") {
      await client.cancelRuntime(runtimeId).catch(() => undefined);
      const verdict = classifyRun(null, { localTimeout: true });
      return {
        testCaseId: c.testCaseId,
        rep: rep,
        outcome: verdict.outcome,
        bucket: verdict.bucket,
        reason: verdict.reason,
        runtimeId: runtimeId,
        durationMs: Date.now() - started,
      };
    }
    const verdict = classifyRun(polled);
    return {
      testCaseId: c.testCaseId,
      rep: rep,
      outcome: verdict.outcome,
      bucket: verdict.bucket,
      reason: verdict.reason,
      runtimeId: runtimeId,
      runId: polled.id,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      testCaseId: c.testCaseId,
      rep: rep,
      outcome: OutcomeClass.Error,
      bucket: transportBucket(reason),
      reason: reason,
      runtimeId: runtimeId,
      durationMs: Date.now() - started,
    };
  }
}

interface Task {
  c: GoldenCase;
  rep: number;
}

/** The (case × rep) tasks a config would run against a golden set, after filter + resume-skip. */
export function planTasks (golden: GoldenSet, config: BatchConfig, hooks: BatchHooks = {}): Task[] {
  const cases = golden.cases.filter((c) => !config.caseFilter || config.caseFilter.includes(c.testCaseId));
  const tasks: Task[] = [];
  for (const c of cases) {
    for (let rep = 1; rep <= config.runs; rep++) {
      if (hooks.skip?.(c.testCaseId, rep)) continue;
      tasks.push({ c: c, rep: rep });
    }
  }
  return tasks;
}

/**
 * Run every (case × rep) task with bounded concurrency, polling each to a
 * terminal verdict. Reps are reported via `hooks.onRepDone` as they finish so
 * the caller can persist incrementally; `hooks.skip` lets a resume drop reps
 * already on disk.
 */
export async function runBatch (
  client: BackendClient,
  golden: GoldenSet,
  config: BatchConfig,
  hooks: BatchHooks = {},
): Promise<RepResult[]> {
  const tasks = planTasks(golden, config, hooks);
  const results: RepResult[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      const task = tasks[i];
      const result = await runOne(client, task.c, task.rep, config);
      results.push(result);
      hooks.onRepDone?.(result);
    }
  };
  const workers = Math.max(1, Math.min(config.concurrency, tasks.length));
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return results;
}
