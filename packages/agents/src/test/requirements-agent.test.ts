import { describe, it, expect, vi } from 'vitest';
import { RequirementsAgent } from '../requirements-agent.js';
import type { TaskSpec } from '@muggleai/workflows';

describe('RequirementsAgent', () => {
  it('returns a TaskSpec with goal and acceptanceCriteria', async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      goal: 'Add user login',
      acceptanceCriteria: ['User can log in with email/password'],
      hintedRepos: ['frontend'],
    } satisfies TaskSpec);
    const agent = new RequirementsAgent({ llm: mockLlm });
    const result = await agent.run('Add a login feature to the app');
    expect(result.goal).toBe('Add user login');
    expect(result.acceptanceCriteria).toHaveLength(1);
    expect(result.hintedRepos).toContain('frontend');
  });

  it('passes the user prompt to the LLM', async () => {
    const mockLlm = vi.fn().mockResolvedValue({ goal: 'x', acceptanceCriteria: [], hintedRepos: [] });
    const agent = new RequirementsAgent({ llm: mockLlm });
    await agent.run('my prompt');
    expect(mockLlm).toHaveBeenCalledWith(expect.stringContaining('my prompt'));
  });
});
