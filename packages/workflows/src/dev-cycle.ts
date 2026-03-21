import type {
  TaskSpec, ChangePlan, CodeResult, UnitTestResult,
  EnvState, TestManifest, QAReport, PRInput,
} from './contracts.js';
import { WorkflowRunner } from './runner.js';
import type { WorkflowConfig } from './config.js';
import { Stage } from './dag.js';

export interface DevCycleAgents {
  requirements: (prompt: string) => Promise<TaskSpec>;
  impactAnalysis: (spec: TaskSpec) => Promise<ChangePlan>;
  coding: (plan: ChangePlan, retryCount: number, failures: string[]) => Promise<CodeResult>;
  unitTests: (code: CodeResult) => Promise<UnitTestResult>;
  ensureAuth: () => Promise<void>;
  envSetup: (plan: ChangePlan) => Promise<EnvState>;
  testScope: (plan: ChangePlan) => Promise<TestManifest>;
  qa: (manifest: TestManifest) => Promise<QAReport>;
  openPRs: (input: PRInput) => Promise<string[]>;
  teardown: (env: EnvState) => Promise<void>;
}

export interface DevCycleResult {
  prUrls: string[];
  qaReport: QAReport;
}

export async function runDevCycle(
  userPrompt: string,
  agents: DevCycleAgents,
  config: WorkflowConfig
): Promise<DevCycleResult> {
  const runner = new WorkflowRunner(config);
  const state = runner.createState();

  // Stage 1: Requirements
  const taskSpec = await agents.requirements(userPrompt);

  // Stage 2: Impact Analysis
  const changePlan = await agents.impactAnalysis(taskSpec);

  let codeResult: CodeResult | null = null;
  let unitTestResult: UnitTestResult | null = null;
  let qaReport: QAReport | null = null;
  const failures: string[] = [];

  // Retry loop: stages 3–7
  while (true) {
    // Stage 3: Coding
    codeResult = await agents.coding(changePlan, state.retryCount, failures);

    // Halt if a required-for-QA repo failed coding
    const requiredFailed = changePlan.perRepo.find(
      (r) => r.requiredForQA && codeResult!.perRepo.find((cr) => cr.repo === r.repo)?.status === 'failed'
    );
    if (requiredFailed) {
      throw new Error(`Required repo "${requiredFailed.repo}" failed to implement changes.`);
    }

    // Stage 4: Unit Tests
    unitTestResult = await agents.unitTests(codeResult);
    const allPassed = unitTestResult.perRepo.every((r) => r.passed);

    if (!allPassed) {
      if (runner.isMaxRetriesExceeded(state)) {
        if (state.envStarted) {
          const envResult = state.stageResults.get(Stage.EnvSetup);
          const envState = envResult?.output as EnvState | undefined;
          if (envState) await agents.teardown(envState);
        }
        throw new Error(`Unit tests failed after ${state.retryCount} retries.`);
      }
      failures.push(...unitTestResult.perRepo.filter((r) => !r.passed).map((r) => r.output));
      runner.recordRetry(state);
      continue;
    }

    // Stage 5: Auth check (lazy — only on first pass) then Env Setup
    if (!state.envStarted) {
      await agents.ensureAuth();
      const envState = await agents.envSetup(changePlan);
      state.envStarted = true;
      state.stageResults.set(Stage.EnvSetup, { stage: Stage.EnvSetup, status: 'succeeded', output: envState });
    }
    const envState = (state.stageResults.get(Stage.EnvSetup)?.output) as EnvState;

    // Stage 6: Test Scope
    const manifest = await agents.testScope(changePlan);

    // Stage 7: QA
    qaReport = await agents.qa(manifest);

    if (qaReport.failed.length === 0) break; // QA passed

    if (runner.isMaxRetriesExceeded(state)) {
      if (runner.shouldOpenPRsOnFailure()) {
        // requireQAPass: false — teardown first, then open PRs
        if (state.envStarted) { await agents.teardown(envState); state.tornDown = true; }
        break;
      }
      if (state.envStarted) await agents.teardown(envState);
      throw new Error(`QA failed after ${state.retryCount} retries.`);
    }

    failures.push(...qaReport.failed.map((f) => `${f.testCase.useCase}: ${f.reason}`));
    runner.recordRetry(state);
  }

  const envResult = state.stageResults.get(Stage.EnvSetup);
  const envState = envResult?.output as EnvState | undefined;

  // Stage 8: Open PRs
  const prUrls = await agents.openPRs({
    taskSpec,
    changePlan,
    codeResult: codeResult!,
    qaReport: qaReport!,
  });

  // Stage 9: Teardown (only if not already torn down)
  if (envState && !state.tornDown) await agents.teardown(envState);

  return { prUrls, qaReport: qaReport! };
}
