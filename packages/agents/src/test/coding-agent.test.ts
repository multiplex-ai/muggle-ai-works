import { describe, it, expect, vi } from 'vitest';
import { CodingAgent } from '../coding-agent.js';
import type { ChangePlanRepo } from '@muggleai/workflows';

const repoEntry: ChangePlanRepo = { repo: 'frontend', changes: ['Add login page'], files: ['src/Login.tsx'], requiredForQA: true };

describe('CodingAgent', () => {
  it('returns success CodeResultRepo when LLM succeeds', async () => {
    const mockImplement = vi.fn().mockResolvedValue({ branch: 'feat/login', diff: '+login page' });
    const agent = new CodingAgent({ implement: mockImplement });
    const result = await agent.run({ repoEntry, retryContext: { retryCount: 0, previousFailures: [] } });
    expect(result.status).toBe('success');
    expect(result.branch).toBe('feat/login');
    expect(result.repo).toBe('frontend');
  });

  it('returns failed CodeResultRepo when implementation throws', async () => {
    const mockImplement = vi.fn().mockRejectedValue(new Error('git conflict'));
    const agent = new CodingAgent({ implement: mockImplement });
    const result = await agent.run({ repoEntry, retryContext: { retryCount: 0, previousFailures: [] } });
    expect(result.status).toBe('failed');
    expect(result.error).toContain('git conflict');
  });

  it('passes retryCount to implementation fn', async () => {
    const mockImplement = vi.fn().mockResolvedValue({ branch: 'b', diff: '' });
    const agent = new CodingAgent({ implement: mockImplement });
    await agent.run({ repoEntry, retryContext: { retryCount: 2, previousFailures: ['test failed'] } });
    expect(mockImplement).toHaveBeenCalledWith(expect.objectContaining({ retryCount: 2 }));
  });
});
