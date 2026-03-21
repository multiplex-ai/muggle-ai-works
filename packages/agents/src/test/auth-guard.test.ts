import { describe, it, expect, vi } from 'vitest';
import { AuthGuard } from '../auth-guard.js';

describe('AuthGuard', () => {
  it('resolves immediately when credentials are valid', async () => {
    const getCredentials = vi.fn().mockResolvedValue({ accessToken: 'tok', expiresAt: Date.now() + 9999 });
    const guard = new AuthGuard({ getCredentials, startDeviceFlow: vi.fn(), refreshToken: vi.fn() });
    await expect(guard.ensureAuthenticated()).resolves.toBeUndefined();
    expect(getCredentials).toHaveBeenCalledOnce();
  });

  it('triggers device code flow when credentials are missing', async () => {
    const getCredentials = vi.fn().mockResolvedValue(null);
    const startDeviceFlow = vi.fn().mockResolvedValue(undefined);
    const guard = new AuthGuard({ getCredentials, startDeviceFlow, refreshToken: vi.fn() });
    await guard.ensureAuthenticated();
    expect(startDeviceFlow).toHaveBeenCalledOnce();
  });

  it('refreshes token when credentials are expired but refresh token valid', async () => {
    const getCredentials = vi.fn().mockResolvedValue({ accessToken: 'tok', expiresAt: Date.now() - 1, refreshToken: 'rt' });
    const refreshToken = vi.fn().mockResolvedValue(undefined);
    const guard = new AuthGuard({ getCredentials, startDeviceFlow: vi.fn(), refreshToken });
    await guard.ensureAuthenticated();
    expect(refreshToken).toHaveBeenCalledOnce();
  });

  it('throws if device flow fails', async () => {
    const getCredentials = vi.fn().mockResolvedValue(null);
    const startDeviceFlow = vi.fn().mockRejectedValue(new Error('network error'));
    const guard = new AuthGuard({ getCredentials, startDeviceFlow, refreshToken: vi.fn() });
    await expect(guard.ensureAuthenticated()).rejects.toThrow('network error');
  });
});
