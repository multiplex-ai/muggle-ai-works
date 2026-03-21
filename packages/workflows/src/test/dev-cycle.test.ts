import { describe, it, expect, vi } from 'vitest';
import { runDevCycle } from '../dev-cycle.js';
import { defaultConfig } from '../config.js';
import type { DevCycleAgents } from '../dev-cycle.js';

function makeAgents(overrides: Partial<DevCycleAgents> = {}): DevCycleAgents {
  return {
    requirements: vi.fn().mockResolvedValue({ goal: 'Add login', acceptanceCriteria: [], hintedRepos: [] }),
    impactAnalysis: vi.fn().mockResolvedValue({
      resolvedRepos: ['frontend'],
      perRepo: [{ repo: 'frontend', changes: [], files: [], requiredForQA: true }],
    }),
    coding: vi.fn().mockResolvedValue({
      perRepo: [{ repo: 'frontend', branch: 'feat/login', diff: '', status: 'success' }],
    }),
    unitTests: vi.fn().mockResolvedValue({ perRepo: [{ repo: 'frontend', passed: true, output: '', failedTests: [] }] }),
    ensureAuth: vi.fn().mockResolvedValue(undefined),
    envSetup: vi.fn().mockResolvedValue({ services: [{ name: 'frontend' }] }),
    testScope: vi.fn().mockResolvedValue({ testCases: [{ id: 'tc-1', useCase: 'Login', description: '' }] }),
    qa: vi.fn().mockResolvedValue({ passed: [{ id: 'tc-1', useCase: 'Login', description: '' }], failed: [] }),
    openPRs: vi.fn().mockResolvedValue(['https://github.com/org/repo/pull/1']),
    teardown: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('runDevCycle', () => {
  it('runs all stages and returns PR URLs on happy path', async () => {
    const agents = makeAgents();
    const result = await runDevCycle('Add login feature', agents, defaultConfig);

    expect(result.prUrls).toEqual(['https://github.com/org/repo/pull/1']);
    expect(result.qaReport.failed).toHaveLength(0);
    expect(agents.teardown).toHaveBeenCalled();
  });

  it('retries coding when unit tests fail', async () => {
    const coding = vi.fn().mockResolvedValue({
      perRepo: [{ repo: 'frontend', branch: 'feat/login', diff: '', status: 'success' }],
    });
    const unitTests = vi.fn()
      .mockResolvedValueOnce({ perRepo: [{ repo: 'frontend', passed: false, output: 'test failed', failedTests: [] }] })
      .mockResolvedValue({ perRepo: [{ repo: 'frontend', passed: true, output: '', failedTests: [] }] });

    const agents = makeAgents({ coding, unitTests });
    await runDevCycle('Add login feature', agents, defaultConfig);

    expect(coding).toHaveBeenCalledTimes(2);
  });

  it('halts if required repo coding fails', async () => {
    const agents = makeAgents({
      coding: vi.fn().mockResolvedValue({
        perRepo: [{ repo: 'frontend', branch: '', diff: '', status: 'failed', error: 'compile error' }],
      }),
    });
    await expect(runDevCycle('Add login feature', agents, defaultConfig)).rejects.toThrow('Required repo');
  });

  it('tears down env if unit tests fail at max retries after env was started', async () => {
    const unitTests = vi.fn()
      .mockResolvedValueOnce({ perRepo: [{ repo: 'frontend', passed: true, output: '', failedTests: [] }] })
      .mockResolvedValue({ perRepo: [{ repo: 'frontend', passed: false, output: 'fail', failedTests: [] }] });
    const qa = vi.fn().mockResolvedValue({
      passed: [],
      failed: [{ testCase: { id: 'tc-1', useCase: 'Login', description: '' }, reason: 'timeout', repro: '' }],
    });
    const agents = makeAgents({ unitTests, qa });
    await expect(
      runDevCycle('Add login feature', agents, { ...defaultConfig, maxRetries: 2 })
    ).rejects.toThrow('Unit tests failed');
    expect(agents.teardown).toHaveBeenCalled();
  });

  it('opens PRs and tears down before them when requireQAPass: false and QA fails', async () => {
    const qa = vi.fn().mockResolvedValue({
      passed: [],
      failed: [{ testCase: { id: 'tc-1', useCase: 'Login', description: '' }, reason: 'timeout', repro: '' }],
    });
    const teardown = vi.fn().mockResolvedValue(undefined);
    const openPRs = vi.fn().mockResolvedValue(['https://github.com/org/repo/pull/1']);
    const agents = makeAgents({ qa, teardown, openPRs });
    const result = await runDevCycle('Add login', agents, { ...defaultConfig, requireQAPass: false, maxRetries: 1 });

    const teardownCall = teardown.mock.invocationCallOrder[0];
    const openPRsCall = openPRs.mock.invocationCallOrder[0];
    expect(teardownCall).toBeLessThan(openPRsCall);
    expect(result.prUrls).toHaveLength(1);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it('does not start env twice across retries', async () => {
    const unitTests = vi.fn()
      .mockResolvedValueOnce({ perRepo: [{ repo: 'frontend', passed: false, output: '', failedTests: [] }] })
      .mockResolvedValue({ perRepo: [{ repo: 'frontend', passed: true, output: '', failedTests: [] }] });
    const agents = makeAgents({ unitTests });
    await runDevCycle('Add login feature', agents, defaultConfig);

    expect(agents.envSetup).toHaveBeenCalledTimes(1);
  });
});
