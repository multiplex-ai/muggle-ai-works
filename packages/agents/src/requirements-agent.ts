import type { TaskSpec } from '@muggleai/workflows';
import type { IAgent } from './types.js';

export interface RequirementsAgentDeps {
  llm: (prompt: string) => Promise<TaskSpec>;
}

export class RequirementsAgent implements IAgent<string, TaskSpec> {
  constructor(private readonly deps: RequirementsAgentDeps) {}

  async run(userPrompt: string): Promise<TaskSpec> {
    const systemPrompt = `You are a requirements analyst. The user describes a software task.
Extract a structured TaskSpec with:
- goal: a single sentence describing what to build
- acceptanceCriteria: bullet-point list of verifiable conditions
- hintedRepos: list of repository names the user mentioned or implied

User prompt: ${userPrompt}

Respond with valid JSON matching the TaskSpec shape.`;
    return this.deps.llm(systemPrompt);
  }
}
