import type { TaskSpec, ChangePlan } from '@muggleai/workflows';
import type { IAgent } from './types.js';

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
    const prompt = `You are a software architect. Analyze this task and determine which repositories need changes.

Task: ${spec.goal}
Acceptance criteria: ${spec.acceptanceCriteria.join(', ')}
Hinted repos: ${spec.hintedRepos.join(', ')}

Repo structures:
${structures.map((s) => `--- ${s.repo} ---\n${s.structure}`).join('\n\n')}

Produce a ChangePlan JSON:
- resolvedRepos: authoritative list of affected repos (may expand beyond hinted)
- perRepo: array of { repo, changes[], files[], requiredForQA } entries
  - requiredForQA: true if QA cannot run without this repo's changes deployed

Respond with valid JSON.`;
    return this.deps.llm(prompt);
  }
}
