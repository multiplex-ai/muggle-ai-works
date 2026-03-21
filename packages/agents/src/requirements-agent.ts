import type { TaskSpec } from '@muggleai/workflows';
import type { IAgent } from './types.js';
import { loadPrompt } from './load-prompt.js';

export interface RequirementsAgentDeps {
  llm: (prompt: string) => Promise<TaskSpec>;
}

export class RequirementsAgent implements IAgent<string, TaskSpec> {
  constructor(private readonly deps: RequirementsAgentDeps) {}

  async run(userPrompt: string): Promise<TaskSpec> {
    const systemPrompt = await loadPrompt('requirements-agent');
    const fullPrompt = `${systemPrompt}\n\n## User request\n\n${userPrompt}`;
    return this.deps.llm(fullPrompt);
  }
}
