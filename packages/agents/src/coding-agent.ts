import type { ChangePlanRepo, CodeResultRepo } from '@muggleai/workflows';
import type { IAgent, RetryContext } from './types.js';

export interface CodingAgentInput {
  repoEntry: ChangePlanRepo;
  retryContext: RetryContext;
}

export interface ImplementationResult {
  branch: string;
  diff: string;
}

export interface CodingAgentDeps {
  implement: (input: { repoEntry: ChangePlanRepo; retryCount: number; previousFailures: string[] }) => Promise<ImplementationResult>;
}

export class CodingAgent implements IAgent<CodingAgentInput, CodeResultRepo> {
  constructor(private readonly deps: CodingAgentDeps) {}

  async run(input: CodingAgentInput): Promise<CodeResultRepo> {
    try {
      const result = await this.deps.implement({
        repoEntry: input.repoEntry,
        retryCount: input.retryContext.retryCount,
        previousFailures: input.retryContext.previousFailures,
      });
      return { repo: input.repoEntry.repo, branch: result.branch, diff: result.diff, status: 'success' };
    } catch (err) {
      return {
        repo: input.repoEntry.repo, branch: '', diff: '', status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
