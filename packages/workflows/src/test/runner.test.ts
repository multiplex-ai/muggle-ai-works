import { describe, it, expect } from 'vitest';
import { WorkflowRunner } from '../runner.js';
import { defaultConfig } from '../config.js';
import type { CodeResult } from '../contracts.js';

describe('WorkflowRunner', () => {
  it('increments retryCount on each retry', () => {
    const runner = new WorkflowRunner(defaultConfig);
    const state = runner.createState();
    runner.recordRetry(state);
    runner.recordRetry(state);
    expect(state.retryCount).toBe(2);
  });

  it('isMaxRetriesExceeded returns true at maxRetries', () => {
    const runner = new WorkflowRunner({ ...defaultConfig, maxRetries: 2 });
    const state = runner.createState();
    state.retryCount = 2;
    expect(runner.isMaxRetriesExceeded(state)).toBe(true);
  });

  it('isMaxRetriesExceeded returns false below maxRetries', () => {
    const runner = new WorkflowRunner({ ...defaultConfig, maxRetries: 3 });
    const state = runner.createState();
    state.retryCount = 2;
    expect(runner.isMaxRetriesExceeded(state)).toBe(false);
  });

  it('needsTeardown returns false if env never started', () => {
    const runner = new WorkflowRunner(defaultConfig);
    const state = runner.createState();
    expect(runner.needsTeardown(state)).toBe(false);
  });

  it('needsTeardown returns true after env starts', () => {
    const runner = new WorkflowRunner(defaultConfig);
    const state = runner.createState();
    state.envStarted = true;
    expect(runner.needsTeardown(state)).toBe(true);
  });

  it('shouldOpenPRsOnFailure returns false when requireQAPass is true', () => {
    const runner = new WorkflowRunner({ ...defaultConfig, requireQAPass: true });
    expect(runner.shouldOpenPRsOnFailure()).toBe(false);
  });

  it('shouldOpenPRsOnFailure returns true when requireQAPass is false', () => {
    const runner = new WorkflowRunner({ ...defaultConfig, requireQAPass: false });
    expect(runner.shouldOpenPRsOnFailure()).toBe(true);
  });

  it('successfulRepos filters CodeResult to success only', () => {
    const runner = new WorkflowRunner(defaultConfig);
    const codeResult: CodeResult = {
      perRepo: [
        { repo: 'a', branch: 'b', diff: '', status: 'success' },
        { repo: 'b', branch: 'b', diff: '', status: 'failed', error: 'oops' },
      ],
    };
    expect(runner.successfulRepos(codeResult)).toEqual(['a']);
  });
});
