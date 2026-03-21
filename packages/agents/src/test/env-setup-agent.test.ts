import { describe, it, expect, vi } from 'vitest';
import { EnvSetupAgent } from '../env-setup-agent.js';
import type { ChangePlan } from '@muggleai/workflows';

const plan: ChangePlan = {
  resolvedRepos: ['frontend', 'auth-service'],
  perRepo: [
    { repo: 'frontend', changes: [], files: [], requiredForQA: true },
    { repo: 'auth-service', changes: [], files: [], requiredForQA: true },
  ],
};

describe('EnvSetupAgent', () => {
  it('returns EnvState with started services', async () => {
    const discoverServices = vi.fn().mockResolvedValue([{ name: 'auth-service', startCommand: 'pnpm dev' }]);
    const startService = vi.fn().mockResolvedValue({ name: 'auth-service', pid: 1234 });
    const agent = new EnvSetupAgent({ discoverServices, startService });
    const state = await agent.run(plan);
    expect(state.services).toHaveLength(1);
    expect(state.services[0].name).toBe('auth-service');
    expect(state.services[0].pid).toBe(1234);
  });

  it('calls discoverServices with the change plan', async () => {
    const discoverServices = vi.fn().mockResolvedValue([]);
    const agent = new EnvSetupAgent({ discoverServices, startService: vi.fn() });
    await agent.run(plan);
    expect(discoverServices).toHaveBeenCalledWith(plan);
  });

  it('throws if a service fails to start', async () => {
    const discoverServices = vi.fn().mockResolvedValue([{ name: 'auth-service', startCommand: 'pnpm dev' }]);
    const startService = vi.fn().mockRejectedValue(new Error('port in use'));
    const agent = new EnvSetupAgent({ discoverServices, startService });
    await expect(agent.run(plan)).rejects.toThrow('Failed to start service "auth-service": port in use');
  });

  it('attaches partialEnvState to error when second service fails', async () => {
    const firstHandle = { name: 'frontend', pid: 1001 };
    const discoverServices = vi.fn().mockResolvedValue([
      { name: 'frontend', startCommand: 'pnpm dev' },
      { name: 'auth-service', startCommand: 'pnpm dev' },
    ]);
    const startService = vi.fn()
      .mockResolvedValueOnce(firstHandle)
      .mockRejectedValueOnce(new Error('port in use'));
    const agent = new EnvSetupAgent({ discoverServices, startService });

    let thrown: unknown;
    try {
      await agent.run(plan);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as any).partialEnvState).toBeDefined();
    expect((thrown as any).partialEnvState.services).toHaveLength(1);
    expect((thrown as any).partialEnvState.services[0]).toBe(firstHandle);
  });
});
