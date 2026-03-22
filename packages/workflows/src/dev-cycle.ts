import type {
  TaskSpec, ChangePlan, CodeResult, EnvState,
  QAReport, PRInput,
} from './contracts.js';
import type { WorkflowConfig } from './config.js';

export interface DevCycleAgents {
  requirements: (prompt: string) => Promise<TaskSpec>;
  impactAnalysis: (spec: TaskSpec) => Promise<ChangePlan>;
  coding: (plan: ChangePlan) => Promise<CodeResult>;
  unitTests: (code: CodeResult) => Promise<import('./contracts.js').UnitTestResult>;
  ensureAuth: () => Promise<void>;
  envSetup: (plan: ChangePlan) => Promise<EnvState>;
  testScope: (plan: ChangePlan) => Promise<import('./contracts.js').TestManifest>;
  qa: (manifest: import('./contracts.js').TestManifest) => Promise<QAReport>;
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
  // 1. Requirements
  const taskSpec = await agents.requirements(userPrompt);

  // 2. Impact Analysis
  const changePlan = await agents.impactAnalysis(taskSpec);

  // 3. Coding — reads current git state written by the AI
  const codeResult = await agents.coding(changePlan);

  // 4. Unit Tests — fail fast, no retry
  const unitTestResult = await agents.unitTests(codeResult);
  const failedRepos = unitTestResult.perRepo.filter((r) => !r.passed);
  if (failedRepos.length > 0) {
    const summary = failedRepos.map((r) => `[${r.repo}]\n${r.output}`).join('\n\n');
    throw new Error(`Unit tests failed. Fix the issues and run again.\n\n${summary}`);
  }

  // 5. Auth
  await agents.ensureAuth();

  // 6. Env Setup
  let envState: EnvState;
  try {
    envState = await agents.envSetup(changePlan);
  } catch (err: unknown) {
    // Partial env teardown if setup failed mid-way
    if (err instanceof Error && 'partialEnvState' in err) {
      const partial = (err as Error & { partialEnvState: EnvState }).partialEnvState;
      if (partial.services.length > 0) await agents.teardown(partial);
    }
    throw err;
  }

  try {
    // 7. Test Scope
    const manifest = await agents.testScope(changePlan);

    // 8. QA
    const qaReport = await agents.qa(manifest);

    if (qaReport.failed.length > 0 && config.requireQAPass) {
      const summary = qaReport.failed
        .map((f) => `- ${f.testCase.useCase}: ${f.reason}`)
        .join('\n');
      throw new Error(`QA failed:\n${summary}`);
    }

    // 9. Open PRs
    const prUrls = await agents.openPRs({ taskSpec, changePlan, codeResult, qaReport });

    return { prUrls, qaReport };
  } finally {
    // 10. Teardown — always runs after env is up
    if (envState.services.length > 0) {
      await agents.teardown(envState);
    }
  }
}
