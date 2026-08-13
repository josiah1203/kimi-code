import { describe, expect, it, vi } from 'vitest';

import { verifyCommercialSessionSync } from './commercial-session-sync';

const session = {
  getToken: async () => 'clerk-session-token',
} as unknown as Parameters<typeof verifyCommercialSessionSync>[0];

describe('commercial session sync boundary', () => {
  it('fails closed when the hosted endpoint is not configured', async () => {
    const response = await verifyCommercialSessionSync(session, undefined);
    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({ code: 'commercial_session_sync_not_configured' });
  });

  it('forwards the server-issued Clerk token and accepts an authorized sync', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://commercial.example.test/api/v1/commercial/session');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer clerk-session-token');
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(verifyCommercialSessionSync(session, 'https://commercial.example.test')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('does not expose the commercial response and maps membership denial to platform denial', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider details', { status: 401 })));

    const response = await verifyCommercialSessionSync(session, 'https://commercial.example.test');
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      code: 'commercial_access_denied',
      message: 'The signed-in principal is not authorized for the hosted commercial tenant.',
    });
    vi.unstubAllGlobals();
  });
});
