import type { ChangePlan, TestManifest, TestCaseRef } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface TestScopeInput {
  changePlan: ChangePlan;
  previousQAReport?: { failedTestIds: string[] };
}
export interface TestScopeAgentDeps {
  llm: (prompt: string) => Promise<TestManifest>;
  fetchAllTestCases: () => Promise<TestCaseRef[]>;
}

export class TestScopeAgent implements IAgent<TestScopeInput, TestManifest> {
  constructor(private readonly deps: TestScopeAgentDeps) {}

  async run(input: TestScopeInput): Promise<TestManifest> {
    const allTests = await this.deps.fetchAllTestCases();
    const changedFiles = input.changePlan.perRepo.flatMap((r) => r.files);
    const changes = input.changePlan.perRepo.flatMap((r) => r.changes);
    const prompt = `You are a QA engineer. Select which test cases to run based on the code changes.

Changed files: ${changedFiles.join(', ')}
Change descriptions: ${changes.join(', ')}

All available test cases:
${allTests.map((t) => `- id: ${t.id}, useCase: ${t.useCase}, description: ${t.description}`).join('\n')}

Select only the test cases impacted by the changes. Respond with JSON: { testCases: TestCaseRef[], skipReason?: string }`;
    return this.deps.llm(prompt);
  }
}
