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
  it('runs all stages in order and returns PR URLs', async () => {
    const agents = makeAgents();
    const result = await runDevCycle('Add login feature', agents, defaultConfig);

    expect(result.prUrls).toEqual(['https://github.com/org/repo/pull/1']);
    expect(result.qaReport.failed).toHaveLength(0);
    expect(agents.requirements).toHaveBeenCalledWith('Add login feature');
    expect(agents.teardown).toHaveBeenCalledWith({ services: [{ name: 'frontend' }] });
  });

  it('throws immediately when unit tests fail', async () => {
    const agents = makeAgents({
      unitTests: vi.fn().mockResolvedValue({
        perRepo: [{ repo: 'frontend', passed: false, output: 'SyntaxError: unexpected token', failedTests: [] }],
      }),
    });

    await expect(runDevCycle('Add login feature', agents, defaultConfig))
      .rejects.toThrow('Unit tests failed');

    expect(agents.envSetup).not.toHaveBeenCalled();
    expect(agents.openPRs).not.toHaveBeenCalled();
  });

  it('throws when QA fails and requireQAPass is true', async () => {
    const agents = makeAgents({
      qa: vi.fn().mockResolvedValue({
        passed: [],
        failed: [{ testCase: { id: 'tc-1', useCase: 'Login', description: '' }, reason: 'timeout', repro: '' }],
      }),
    });

    await expect(runDevCycle('Add login feature', agents, defaultConfig))
      .rejects.toThrow('QA failed');

    expect(agents.openPRs).not.toHaveBeenCalled();
    expect(agents.teardown).toHaveBeenCalled();
  });

  it('opens PRs with failures when requireQAPass is false', async () => {
    const agents = makeAgents({
      qa: vi.fn().mockResolvedValue({
        passed: [],
        failed: [{ testCase: { id: 'tc-1', useCase: 'Login', description: '' }, reason: 'timeout', repro: '' }],
      }),
    });

    const result = await runDevCycle('Add login feature', agents, { requireQAPass: false });

    expect(result.prUrls).toHaveLength(1);
    expect(result.qaReport.failed).toHaveLength(1);
    expect(agents.teardown).toHaveBeenCalled();
  });

  it('always tears down env even when QA throws', async () => {
    const agents = makeAgents({
      qa: vi.fn().mockRejectedValue(new Error('QA service unreachable')),
    });

    await expect(runDevCycle('Add login feature', agents, defaultConfig))
      .rejects.toThrow('QA service unreachable');

    expect(agents.teardown).toHaveBeenCalled();
  });

  it('tears down partial env if envSetup fails mid-way', async () => {
    const partialEnvState = { services: [{ name: 'db', pid: 1234 }] };
    const err = Object.assign(new Error('redis failed to start'), { partialEnvState });
    const agents = makeAgents({ envSetup: vi.fn().mockRejectedValue(err) });

    await expect(runDevCycle('Add login feature', agents, defaultConfig)).rejects.toThrow('redis failed to start');
    expect(agents.teardown).toHaveBeenCalledWith(partialEnvState);
  });

  it('skips teardown when env has no services', async () => {
    const agents = makeAgents({ envSetup: vi.fn().mockResolvedValue({ services: [] }) });
    await runDevCycle('Add login feature', agents, defaultConfig);
    expect(agents.teardown).not.toHaveBeenCalled();
  });
});
