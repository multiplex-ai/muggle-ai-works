import type { PRInput } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface OpenPRInput { repo: string; branch: string; title: string; body: string; }
export interface PRAgentDeps { openPR: (input: OpenPRInput) => Promise<string>; }

export class PRAgent implements IAgent<PRInput, string[]> {
  constructor(private readonly deps: PRAgentDeps) {}

  async run(input: PRInput): Promise<string[]> {
    const hasQAFailures = input.qaReport.failed.length > 0;
    const successRepos = input.codeResult.perRepo.filter((r) => r.status === 'success');
    const urls = await Promise.all(
      successRepos.map((repo) => {
        const title = hasQAFailures ? `[QA FAILING] ${input.taskSpec.goal}` : input.taskSpec.goal;
        const body = this.buildPRBody(input, repo.repo, hasQAFailures);
        return this.deps.openPR({ repo: repo.repo, branch: repo.branch, title, body });
      })
    );
    return urls;
  }

  private buildPRBody(input: PRInput, repo: string, hasQAFailures: boolean): string {
    const plan = input.changePlan.perRepo.find((p) => p.repo === repo);
    const lines = [
      `## Goal\n${input.taskSpec.goal}`,
      ...(input.taskSpec.acceptanceCriteria.length > 0
        ? [`## Acceptance Criteria\n${input.taskSpec.acceptanceCriteria.map((c) => `- ${c}`).join('\n')}`]
        : []),
      `## Changes\n${(plan?.changes ?? []).map((c) => `- ${c}`).join('\n')}`,
    ];
    if (hasQAFailures) {
      lines.push(`## QA Failures\n${input.qaReport.failed.map((f) => `- ${f.testCase.useCase}: ${f.reason}`).join('\n')}`);
    } else {
      lines.push(`## QA\n✅ All test cases passed.`);
    }
    return lines.join('\n\n');
  }
}
