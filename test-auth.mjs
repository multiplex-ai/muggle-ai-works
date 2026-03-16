import { getAuthService } from './dist/chunk-B35DRG55.js';

async function test() {
  const authService = getAuthService();
  const storedAuth = authService.loadStoredAuth();
  console.log('Stored auth exists:', !!storedAuth);
  console.log('Has access token:', !!storedAuth?.accessToken);
  console.log('Has refresh token:', !!storedAuth?.refreshToken);
  console.log('Expires at:', storedAuth?.expiresAt);

  const now = new Date();
  const expiresAt = storedAuth ? new Date(storedAuth.expiresAt) : null;
  console.log('Now:', now.toISOString());
  console.log('Is strictly expired:', expiresAt ? now >= expiresAt : 'N/A');

  const token = await authService.getValidAccessToken();
  console.log('getValidAccessToken result:', token ? 'HAS TOKEN' : 'NULL');
}
test().catch(console.error);

