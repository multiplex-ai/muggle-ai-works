import type { TaskSpec, ChangePlan } from '@muggleai/workflows';
import type { IAgent } from './types.js';
import { loadPrompt } from './load-prompt.js';

export interface ImpactAnalysisAgentDeps {
  llm: (prompt: string) => Promise<ChangePlan>;
  readRepoStructure: (repoName: string) => Promise<string>;
}

export class ImpactAnalysisAgent implements IAgent<TaskSpec, ChangePlan> {
  constructor(private readonly deps: ImpactAnalysisAgentDeps) {}

  async run(spec: TaskSpec): Promise<ChangePlan> {
    const structures = await Promise.all(
      spec.hintedRepos.map(async (repo) => ({
        repo,
        structure: await this.deps.readRepoStructure(repo),
      }))
    );

    const systemPrompt = await loadPrompt('impact-analysis-agent');
    const fullPrompt = `${systemPrompt}

## Task

**Goal:** ${spec.goal}
**Acceptance criteria:** ${spec.acceptanceCriteria.join(', ')}
**Hinted repos:** ${spec.hintedRepos.join(', ')}

## Repository structures

${structures.map((s) => `### ${s.repo}\n\n${s.structure}`).join('\n\n')}`;

    return this.deps.llm(fullPrompt);
  }
}
