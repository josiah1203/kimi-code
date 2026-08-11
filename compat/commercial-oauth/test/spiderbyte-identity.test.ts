import { describe, expect, it, vi } from 'vitest';

import {
  SpiderByteIdentityClient,
  SpiderByteIdentityError,
  type SpiderByteAccountToken,
  type SpiderByteTokenStorage,
} from '../src/spiderbyte-identity';

function memoryStorage(initial?: SpiderByteAccountToken): SpiderByteTokenStorage & {
  value: SpiderByteAccountToken | undefined;
} {
  const storage = {
    value: initial,
    load: async () => storage.value,
    save: async (token: SpiderByteAccountToken) => { storage.value = token; },
    remove: async () => { storage.value = undefined; },
  };
  return storage;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('SpiderByteIdentityClient', () => {
  it('builds a PKCE authorization request without exposing credentials', async () => {
    const client = new SpiderByteIdentityClient({
      config: {
        issuer: 'https://identity.example.test',
        clientId: 'spiderbyte-cli',
        authorizationEndpoint: 'https://identity.example.test/oauth/authorize',
        tokenEndpoint: 'https://identity.example.test/oauth/token',
        redirectUri: 'http://127.0.0.1:4321/callback',
      },
      storage: memoryStorage(),
    });

    const request = await client.createAuthorizationRequest({ state: 'known-state', nonce: 'known-nonce' });
    const url = new URL(request.url);
    expect(url.searchParams.get('client_id')).toBe('spiderbyte-cli');
    expect(url.searchParams.get('state')).toBe('known-state');
    expect(url.searchParams.get('nonce')).toBe('known-nonce');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBeTruthy();
    expect(url.toString()).not.toContain('access_token');
    expect(request.codeVerifier).not.toBe('known-state');
  });

  it('exchanges and refreshes an account token through the configured authority', async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid',
      }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'access-2',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid',
      }));
    const client = new SpiderByteIdentityClient({
      config: {
        issuer: 'https://identity.example.test',
        clientId: 'spiderbyte-cli',
        tokenEndpoint: 'https://identity.example.test/oauth/token',
        authorizationEndpoint: 'https://identity.example.test/oauth/authorize',
        redirectUri: 'http://127.0.0.1:4321/callback',
      },
      storage,
      fetchImpl,
      now: () => 100,
    });

    await client.exchangeAuthorizationCode('code-1', 'verifier-1');
    expect((await client.status()).authenticated).toBe(true);
    expect(await client.getAccessToken()).toBe('access-1');

    storage.value = { ...storage.value!, expiresAt: 101 };
    expect(await client.getAccessToken()).toBe('access-2');
    expect(storage.value?.refreshToken).toBe('refresh-1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[1]?.body)).toContain('code=code-1');
    expect(String(fetchImpl.mock.calls[1]?.[1]?.body)).toContain('grant_type=refresh_token');
  });

  it('supports device authorization and rejects unsafe hosted authorities', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        device_code: 'device-1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://identity.example.test/device',
        expires_in: 600,
        interval: 5,
      }))
      .mockResolvedValueOnce(jsonResponse({ error: 'authorization_pending' }, 400))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 600,
      }));
    const client = new SpiderByteIdentityClient({
      config: {
        issuer: 'https://identity.example.test',
        clientId: 'spiderbyte-cli',
        tokenEndpoint: 'https://identity.example.test/oauth/token',
        authorizationEndpoint: 'https://identity.example.test/oauth/authorize',
        deviceAuthorizationEndpoint: 'https://identity.example.test/oauth/device',
      },
      storage: memoryStorage(),
      fetchImpl,
    });
    await expect(client.requestDeviceAuthorization()).resolves.toMatchObject({
      deviceCode: 'device-1',
      userCode: 'ABCD-EFGH',
    });
    await expect(client.pollDeviceAuthorization('device-1')).resolves.toMatchObject({ kind: 'pending' });
    await expect(client.pollDeviceAuthorization('device-1')).resolves.toMatchObject({
      kind: 'success',
      token: { accessToken: 'access-1' },
    });

    expect(() => new SpiderByteIdentityClient({
      config: {
        issuer: 'http://remote.example.test',
        clientId: 'spiderbyte-cli',
      },
      storage: memoryStorage(),
    })).toThrow(SpiderByteIdentityError);
  });
});
