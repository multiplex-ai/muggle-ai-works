import { describe, it, expect, vi } from 'vitest';
import { ImpactAnalysisAgent } from '../impact-analysis-agent.js';
import type { TaskSpec, ChangePlan } from '@muggleai/workflows';

const spec: TaskSpec = { goal: 'Add login', acceptanceCriteria: ['User can log in'], hintedRepos: ['frontend'] };

describe('ImpactAnalysisAgent', () => {
  it('returns a ChangePlan with resolvedRepos', async () => {
    const mockLlm = vi.fn().mockResolvedValue({
      resolvedRepos: ['frontend', 'auth-service'],
      perRepo: [
        { repo: 'frontend', changes: ['Add login page'], files: ['src/Login.tsx'], requiredForQA: true },
        { repo: 'auth-service', changes: ['Add /login endpoint'], files: ['src/routes/auth.ts'], requiredForQA: true },
      ],
    } satisfies ChangePlan);
    const agent = new ImpactAnalysisAgent({ llm: mockLlm, readRepoStructure: vi.fn().mockResolvedValue('{}') });
    const result = await agent.run(spec);
    expect(result.resolvedRepos).toContain('frontend');
    expect(result.perRepo).toHaveLength(2);
    expect(result.perRepo[0].requiredForQA).toBe(true);
  });

  it('reads structure for each hinted repo', async () => {
    const readRepoStructure = vi.fn().mockResolvedValue('{}');
    const mockLlm = vi.fn().mockResolvedValue({ resolvedRepos: [], perRepo: [] });
    const agent = new ImpactAnalysisAgent({ llm: mockLlm, readRepoStructure });
    await agent.run(spec);
    expect(readRepoStructure).toHaveBeenCalledWith('frontend');
  });
});
