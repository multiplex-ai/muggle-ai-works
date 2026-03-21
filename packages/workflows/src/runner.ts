import type { WorkflowConfig } from './config.js';
import type { CodeResult } from './contracts.js';
import { initialState, type WorkflowState } from './dag.js';

export class WorkflowRunner {
  constructor(private readonly config: WorkflowConfig) {}

  createState(): WorkflowState {
    return initialState();
  }

  recordRetry(state: WorkflowState): void {
    state.retryCount += 1;
  }

  isMaxRetriesExceeded(state: WorkflowState): boolean {
    return state.retryCount >= this.config.maxRetries;
  }

  needsTeardown(state: WorkflowState): boolean {
    return state.envStarted;
  }

  shouldOpenPRsOnFailure(): boolean {
    return !this.config.requireQAPass;
  }

  successfulRepos(codeResult: CodeResult): string[] {
    return codeResult.perRepo
      .filter((r) => r.status === 'success')
      .map((r) => r.repo);
  }
}
