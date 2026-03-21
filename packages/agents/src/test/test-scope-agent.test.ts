import { describe, it, expect, vi } from 'vitest';
import { TestScopeAgent } from '../test-scope-agent.js';
import type { ChangePlan } from '@muggleai/workflows';

const plan: ChangePlan = {
  resolvedRepos: ['frontend'],
  perRepo: [{ repo: 'frontend', changes: ['Add login page'], files: ['src/Login.tsx'], requiredForQA: true }],
};

describe('TestScopeAgent', () => {
  it('returns TestManifest with typed TestCaseRef entries', async () => {
    const mockLlm = vi.fn().mockResolvedValue({ testCases: [{ id: 'tc-001', useCase: 'Login', description: 'User can log in' }] });
    const agent = new TestScopeAgent({ llm: mockLlm, fetchAllTestCases: vi.fn().mockResolvedValue([]) });
    const manifest = await agent.run({ changePlan: plan });
    expect(manifest.testCases).toHaveLength(1);
    expect(manifest.testCases[0].id).toBe('tc-001');
  });

  it('passes full test case list and change plan to LLM', async () => {
    const allTests = [{ id: 'tc-001', useCase: 'Login', description: 'test' }];
    const mockLlm = vi.fn().mockResolvedValue({ testCases: [] });
    const agent = new TestScopeAgent({ llm: mockLlm, fetchAllTestCases: vi.fn().mockResolvedValue(allTests) });
    await agent.run({ changePlan: plan });
    expect(mockLlm).toHaveBeenCalledWith(expect.stringContaining('tc-001'));
    expect(mockLlm).toHaveBeenCalledWith(expect.stringContaining('Add login page'));
  });
});
