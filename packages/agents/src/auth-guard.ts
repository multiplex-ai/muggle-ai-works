export interface StoredCredentials { accessToken: string; expiresAt: number; refreshToken?: string; }
export interface AuthGuardDeps {
  getCredentials: () => Promise<StoredCredentials | null>;
  startDeviceFlow: () => Promise<void>;
  refreshToken: (token: string) => Promise<void>;
}

export class AuthGuard {
  constructor(private readonly deps: AuthGuardDeps) {}

  async ensureAuthenticated(): Promise<void> {
    const creds = await this.deps.getCredentials();
    if (!creds) { await this.deps.startDeviceFlow(); return; }
    if (creds.expiresAt <= Date.now()) {
      if (creds.refreshToken) { await this.deps.refreshToken(creds.refreshToken); }
      else { await this.deps.startDeviceFlow(); }
    }
  }
}
