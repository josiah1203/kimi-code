import { describe, expect, it } from 'vitest';

import {
  DeterministicTokenGenerator,
  DevelopmentIdentityAdapter,
  InMemoryAuditWriter,
  InMemoryCommercialStore,
  MonotonicIdGenerator,
} from '../../adapters/src/index';
import { CommercialDirectoryService } from '@spiderbyte/commercial-application';
import Fastify from 'fastify';
import { attachCommercialWebSocket, CommercialApiApplication, CommercialAuthMiddleware, InProcessCommercialEventHub, registerCommercialFastifyRoutes } from '@spiderbyte/commercial-api';

const now = '2026-08-11T12:00:00.000Z';

function createApi() {
  const store = new InMemoryCommercialStore();
  const clock = { now: () => now };
  const identity = new DevelopmentIdentityAdapter({ environment: 'development', clock, tokenGenerator: new DeterministicTokenGenerator() });
  const directory = new CommercialDirectoryService({
    store,
    identity,
    clock,
    ids: new MonotonicIdGenerator(),
    tokens: new DeterministicTokenGenerator(),
    audit: new InMemoryAuditWriter(),
  });
  return { api: new CommercialApiApplication({ directory }), directory, identity };
}

describe('commercial API contracts', () => {
  it('returns request-scoped envelopes and login tokens only after backend confirmation', async () => {
    const { api } = createApi();
    const created = await api.createAccount({ request_id: 'api-account-1' }, {
      request_id: 'ignored-by-transport', actor: { kind: 'system', id: 'api-test' }, email: 'owner@example.test', display_name: 'Owner', secret: 'owner-api-secret',
    });
    expect(created).toMatchObject({ request_id: 'api-account-1', data: { user: { email: 'owner@example.test' } } });
    const login = await api.login({ request_id: 'api-login-1' }, { email: 'owner@example.test', secret: 'owner-api-secret' });
    expect(login).toMatchObject({ request_id: 'api-login-1', data: { session_token: expect.any(String) } });
    const principal = (login as { data: { principal: Parameters<CommercialDirectoryService['createOrganization']>[0] } }).data.principal;
    const organization = await api.createOrganization({ request_id: 'api-org-1' }, principal, { request_id: 'ignored', actor: { kind: 'user', id: 'usr_0002' }, name: 'Hosted Org' });
    expect(organization).toMatchObject({ request_id: 'api-org-1', data: { name: 'Hosted Org' } });
  });

  it('requires bearer sessions and uses the fail-closed identity capability status', async () => {
    const { directory } = createApi();
    const middleware = new CommercialAuthMiddleware(directory);
    await expect(middleware.authenticate({ request_id: 'missing-auth', headers: {} })).rejects.toMatchObject({ status: 401 });
    await expect(middleware.authenticate({ request_id: 'bad-auth', headers: { authorization: 'Basic value' } })).rejects.toMatchObject({ status: 401 });
  });

  it('registers authenticated hosted HTTP routes with request and idempotency headers', async () => {
    const { api, directory } = createApi();
    const app = Fastify();
    const auth = new CommercialAuthMiddleware(directory);
    await registerCommercialFastifyRoutes(app, { application: api, auth, directory });

    const account = await app.inject({
      method: 'POST',
      url: '/api/v1/commercial/accounts',
      headers: { 'x-request-id': 'http-account-1', 'idempotency-key': 'http-account-1' },
      payload: { email: 'http-owner@example.test', display_name: 'HTTP Owner', secret: 'http-owner-secret' },
    });
    expect(account.statusCode).toBe(200);
    const accountReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/commercial/accounts',
      headers: { 'x-request-id': 'http-account-retry', 'idempotency-key': 'http-account-1' },
      payload: { email: 'http-owner@example.test', display_name: 'HTTP Owner', secret: 'http-owner-secret' },
    });
    expect(accountReplay.statusCode).toBe(200);
    expect(accountReplay.json().data.account.id).toBe(account.json().data.account.id);

    const conflictingAccountReplay = await app.inject({
      method: 'POST',
      url: '/api/v1/commercial/accounts',
      headers: { 'x-request-id': 'http-account-conflict', 'idempotency-key': 'http-account-1' },
      payload: { email: 'different@example.test', display_name: 'Different', secret: 'different-secret' },
    });
    expect(conflictingAccountReplay.statusCode).toBe(409);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/commercial/sessions',
      headers: { 'x-request-id': 'http-login-1' },
      payload: { email: 'http-owner@example.test', secret: 'http-owner-secret' },
    });
    expect(login.statusCode).toBe(200);
    const sessionToken = (login.json() as { data: { session_token: string } }).data.session_token;

    const organization = await app.inject({
      method: 'POST',
      url: '/api/v1/commercial/organizations',
      headers: { authorization: `Bearer ${sessionToken}`, 'x-request-id': 'http-org-1', 'idempotency-key': 'http-org-1' },
      payload: { name: 'HTTP Organization' },
    });
    expect(organization.statusCode).toBe(200);
    const organizationId = (organization.json() as { data: { id: string } }).data.id;

    const workspace = await app.inject({
      method: 'POST',
      url: `/api/v1/commercial/organizations/${organizationId}/workspaces`,
      headers: { authorization: `Bearer ${sessionToken}`, 'x-request-id': 'http-workspace-1', 'idempotency-key': 'http-workspace-1' },
      payload: { name: 'HTTP Workspace', slug: 'http-workspace' },
    });
    expect(workspace.statusCode).toBe(200);
    const workspaceId = workspace.json().data.id;

    const unavailableEntitlement = await app.inject({
      method: 'GET',
      url: `/api/v1/commercial/organizations/${organizationId}/entitlements/api_access`,
      headers: { authorization: `Bearer ${sessionToken}`, 'x-request-id': 'http-entitlement-1' },
    });
    expect(unavailableEntitlement.statusCode).toBe(503);
    expect(unavailableEntitlement.json()).toMatchObject({ error: { code: 'commercial.billing.not_configured' } });

    const unavailableLicense = await app.inject({
      method: 'GET',
      url: `/api/v1/commercial/organizations/${organizationId}/license`,
      headers: { authorization: `Bearer ${sessionToken}`, 'x-request-id': 'http-license-unavailable' },
    });
    expect(unavailableLicense.statusCode).toBe(503);
    expect(unavailableLicense.json()).toMatchObject({ error: { code: 'commercial.licensing.not_configured' } });

    const unavailableCompute = await app.inject({
      method: 'POST',
      url: `/api/v1/commercial/organizations/${organizationId}/workspaces/${workspaceId}/compute`,
      headers: { authorization: `Bearer ${sessionToken}`, 'x-request-id': 'http-compute-unavailable' },
      payload: {
        provider_id: 'compute_missing', region_id: 'region_missing', job_class_id: 'jobclass_missing', requested_seconds: 1,
      },
    });
    expect(unavailableCompute.statusCode).toBe(503);
    expect(unavailableCompute.json()).toMatchObject({ error: { code: 'commercial.hosted_compute.not_configured' } });

    const clientControlledPrice = await app.inject({
      method: 'POST',
      url: `/api/v1/commercial/organizations/${organizationId}/workspaces/${workspaceId}/compute`,
      headers: { authorization: `Bearer ${sessionToken}`, 'x-request-id': 'http-client-price-rejected' },
      payload: {
        provider_id: 'compute_missing', region_id: 'region_missing', job_class_id: 'jobclass_missing', requested_seconds: 1,
        price_basis: { unit_price_minor: 0, multiplier: 0.01, currency: 'USD', price_book_id: 'attacker-price' },
      },
    });
    expect(clientControlledPrice.statusCode).toBe(400);

    const unavailableArtifacts = await app.inject({
      method: 'POST',
      url: `/api/v1/commercial/organizations/${organizationId}/workspaces/${workspaceId}/artifacts`,
      headers: { authorization: `Bearer ${sessionToken}`, 'x-request-id': 'http-artifacts-unavailable' },
      payload: { name: 'blocked.txt', media_type: 'text/plain', bytes_base64: 'aGVsbG8=' },
    });
    expect(unavailableArtifacts.statusCode).toBe(503);
    expect(unavailableArtifacts.json()).toMatchObject({ error: { code: 'commercial.hosted_artifacts.not_configured' } });

    const unavailableTeam = await app.inject({
      method: 'POST',
      url: `/api/v1/commercial/organizations/${organizationId}/teams`,
      headers: { authorization: `Bearer ${sessionToken}`, 'x-request-id': 'http-team-unavailable' },
      payload: { name: 'Blocked Team' },
    });
    expect(unavailableTeam.statusCode).toBe(503);
    expect(unavailableTeam.json()).toMatchObject({ error: { code: 'commercial.team.not_configured' } });

    const unavailableEnterprise = await app.inject({
      method: 'POST',
      url: `/api/v1/commercial/organizations/${organizationId}/enterprise/identity-providers`,
      headers: { authorization: `Bearer ${sessionToken}`, 'x-request-id': 'http-sso-unavailable' },
      payload: { type: 'oidc', issuer: 'https://idp.example.test', client_id: 'client' },
    });
    expect(unavailableEnterprise.statusCode).toBe(503);
    expect(unavailableEnterprise.json()).toMatchObject({ error: { code: 'commercial.sso.not_configured' } });

    const unauthorized = await app.inject({
      method: 'GET',
      url: `/api/v1/commercial/organizations/${organizationId}/entitlements/api_access`,
      headers: { 'x-request-id': 'http-unauthorized-1' },
    });
    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.json()).toMatchObject({ error: { code: 'commercial.authentication_required' } });
    await app.close();
  });

  it('filters realtime events by authorized workspace scope', () => {
    const hub = new InProcessCommercialEventHub();
    const principal = {
      subject_id: 'usr_events', account_id: 'acct_01', user_id: 'usr_events', session_id: 'ses_events',
      organization_ids: ['org_01'], scopes: ['organization.read'], auth_method: 'session' as const,
      issued_at: now, expires_at: '2026-08-12T12:00:00.000Z',
    };
    const received: string[] = [];
    const subscription = hub.subscribe({
      principal,
      organization_id: 'org_01',
      workspace_id: 'cws_01',
      handler: (event) => received.push(event.type),
    });
    hub.publish({ organization_id: 'org_01', workspace_id: 'cws_02', type: 'ignored', occurred_at: now, payload: {} });
    hub.publish({ organization_id: 'org_01', workspace_id: 'cws_01', type: 'accepted', occurred_at: now, payload: {} });
    hub.publish({ organization_id: 'org_02', workspace_id: 'cws_01', type: 'ignored', occurred_at: now, payload: {} });
    subscription.close();
    expect(received).toEqual(['accepted']);
  });

  it('rejects websocket upgrades before accepting an unauthenticated hosted request', async () => {
    const { directory } = createApi();
    const app = Fastify();
    const attachment = attachCommercialWebSocket(app, {
      auth: new CommercialAuthMiddleware(directory),
      directory,
      events: new InProcessCommercialEventHub(),
    });
    const writes: string[] = [];
    let destroyed = false;
    const socket = {
      write: (value: string) => {
        writes.push(value);
        return true;
      },
      destroy: () => {
        destroyed = true;
      },
    };
    app.server.emit('upgrade', {
      url: '/api/v1/commercial/events?organization_id=org_missing',
      headers: { host: 'localhost', authorization: 'Bearer invalid' },
    }, socket, Buffer.alloc(0));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(writes[0]).toContain('401 Error');
    expect(writes[0]).toContain('commercial.invalid_session');
    expect(destroyed).toBe(true);
    await attachment.close();
    await app.close();
  });
});
