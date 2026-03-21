import { describe, it, expect, vi } from 'vitest';
import { PRAgent } from '../pr-agent.js';
import type { PRInput } from '@muggleai/workflows';

const prInput: PRInput = {
  taskSpec: { goal: 'Add login', acceptanceCriteria: [], hintedRepos: [] },
  changePlan: { resolvedRepos: ['frontend'], perRepo: [{ repo: 'frontend', changes: [], files: [], requiredForQA: true }] },
  codeResult: {
    perRepo: [
      { repo: 'frontend', branch: 'feat/login', diff: '+login', status: 'success' },
      { repo: 'backend', branch: '', diff: '', status: 'failed', error: 'compile error' },
    ],
  },
  qaReport: { passed: [], failed: [] },
};

describe('PRAgent', () => {
  it('only opens PRs for successful repos', async () => {
    const openPR = vi.fn().mockResolvedValue('https://github.com/org/repo/pull/1');
    const agent = new PRAgent({ openPR });
    const urls = await agent.run(prInput);
    expect(openPR).toHaveBeenCalledTimes(1);
    expect(openPR).toHaveBeenCalledWith(expect.objectContaining({ repo: 'frontend' }));
    expect(urls).toHaveLength(1);
  });

  it('flags PR title with [QA FAILING] when QA failed', async () => {
    const openPR = vi.fn().mockResolvedValue('https://github.com/org/repo/pull/1');
    const agent = new PRAgent({ openPR });
    const failingQA: PRInput = {
      ...prInput,
      qaReport: { passed: [], failed: [{ testCase: { id: '1', useCase: 'Login', description: 'login test' }, reason: 'timeout', repro: '' }] },
    };
    await agent.run(failingQA);
    expect(openPR).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('[QA FAILING]') }));
  });

  it('does not include [QA FAILING] when QA passed', async () => {
    const openPR = vi.fn().mockResolvedValue('https://github.com/org/repo/pull/1');
    const agent = new PRAgent({ openPR });
    await agent.run(prInput);
    expect(openPR).toHaveBeenCalledWith(expect.objectContaining({ title: expect.not.stringContaining('[QA FAILING]') }));
  });
});
