import { describe, expect, it } from 'vitest';

import { decideBffAuthorization, isAllowedSpiderBytePath } from './spiderbyte-bff-policy';

describe('SpiderByte web BFF policy', () => {
  it('rejects missing authentication before reaching the platform', () => {
    expect(decideBffAuthorization({
      path: ['workspaces'],
      hasVerifiedClerkPrincipal: false,
      hasServerPlatformCredential: true,
    })).toEqual({ allowed: false, status: 401, code: 'authentication_required' });
  });

  it('fails closed when the server-side platform credential is absent', () => {
    expect(decideBffAuthorization({
      path: ['sessions', 'ses_example', 'prompts'],
      hasVerifiedClerkPrincipal: true,
      hasServerPlatformCredential: false,
    })).toEqual({ allowed: false, status: 503, code: 'platform_auth_not_configured' });
  });

  it('allows only verified principals with a server credential', () => {
    expect(decideBffAuthorization({
      path: ['workspaces', 'ws_example', 'platform', 'artifacts'],
      hasVerifiedClerkPrincipal: true,
      hasServerPlatformCredential: true,
    })).toEqual({ allowed: true });
  });

  it('requires the identity bridge when hosted mode is configured to fail closed', () => {
    expect(decideBffAuthorization({
      path: ['workspaces'],
      hasVerifiedClerkPrincipal: true,
      hasServerPlatformCredential: true,
      requiresIdentityBridge: true,
      hasIdentityBridgeSecret: false,
    })).toEqual({ allowed: false, status: 503, code: 'identity_bridge_not_configured' });
  });

  it('requires the commercial membership sync endpoint when hosted mode enables it', () => {
    expect(decideBffAuthorization({
      path: ['workspaces'],
      hasVerifiedClerkPrincipal: true,
      hasServerPlatformCredential: true,
      requiresCommercialSessionSync: true,
      hasCommercialSessionSyncEndpoint: false,
    })).toEqual({ allowed: false, status: 503, code: 'commercial_session_sync_not_configured' });
  });

  it('rejects path traversal and unrelated upstream routes', () => {
    expect(isAllowedSpiderBytePath(['../secrets'])).toBe(false);
    expect(isAllowedSpiderBytePath(['admin', 'users'])).toBe(false);
    expect(isAllowedSpiderBytePath(['sessions', '..', 'secrets'])).toBe(false);
    expect(isAllowedSpiderBytePath(['projects', 'prj_example'])).toBe(true);
  });
});
