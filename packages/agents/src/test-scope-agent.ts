import type { ChangePlan, TestManifest, TestCaseRef } from '@muggleai/workflows';
import type { IAgent } from './types.js';
import { loadPrompt } from './load-prompt.js';

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

    const systemPrompt = await loadPrompt('test-scope-agent');
    const fullPrompt = `${systemPrompt}

## Changes

**Modified files:** ${changedFiles.join(', ')}
**Change descriptions:** ${changes.join(', ')}
${input.previousQAReport ? `**Previously failed test IDs:** ${input.previousQAReport.failedTestIds.join(', ')}` : ''}

## Available test cases

${allTests.map((t) => `- id: \`${t.id}\` | use case: ${t.useCase} | ${t.description}`).join('\n')}`;

    return this.deps.llm(fullPrompt);
  }
}
