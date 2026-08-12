import { describe, expect, it } from 'vitest';

import { CommercialSdkClient, type CommercialTransport } from '@spiderbyte/commercial-sdk';
import type { CreateAccountInput, CreateOrganizationInput, CreateWorkspaceInput } from '@spiderbyte/commercial-domain';

describe('commercial SDK transport', () => {
  it('carries request and idempotency context without inventing backend state', async () => {
    const calls: unknown[] = [];
    const transport: CommercialTransport = {
      async request<T>(input: { readonly method: 'GET' | 'POST' | 'DELETE'; readonly path: string; readonly request_id: string; readonly idempotency_key?: string; readonly body?: unknown }) {
        calls.push(input);
        return { request_id: input.request_id, data: {} as T };
      },
    };
    const client = new CommercialSdkClient(transport);
    await client.entitlement('sdk-request-1', 'org_01', 'hosted_compute');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/v1/commercial/organizations/org_01/entitlements/hosted_compute', request_id: 'sdk-request-1' });
  });

  it('sends only public body fields and leaves actor authority to the hosted session', async () => {
    const calls: unknown[] = [];
    const transport: CommercialTransport = {
      async request<T>(input: { readonly method: 'GET' | 'POST' | 'DELETE'; readonly path: string; readonly request_id: string; readonly idempotency_key?: string; readonly body?: unknown }) {
        calls.push(input);
        return { request_id: input.request_id, data: {} as T };
      },
    };
    const client = new CommercialSdkClient(transport);
    const account = {
      request_id: 'sdk-account-1', actor: { kind: 'system', id: 'caller' }, email: 'sdk@example.test', display_name: 'SDK', secret: 'sdk-secret-123',
    } satisfies CreateAccountInput;
    const organization = {
      request_id: 'sdk-org-1', actor: { kind: 'user', id: 'usr_caller' }, name: 'SDK Org',
    } satisfies CreateOrganizationInput;
    const workspace = {
      request_id: 'sdk-workspace-1', actor: { kind: 'user', id: 'usr_caller' }, organization_id: 'org_caller', name: 'SDK Workspace', slug: 'sdk-workspace', region: 'us',
    } satisfies CreateWorkspaceInput;
    await client.createAccount('sdk-http-account', account);
    await client.createOrganization('sdk-http-org', organization);
    await client.createWorkspace('sdk-http-workspace', workspace);
    expect(calls).toEqual([
      expect.objectContaining({ path: '/api/v1/commercial/accounts', body: { email: 'sdk@example.test', display_name: 'SDK', secret: 'sdk-secret-123' } }),
      expect.objectContaining({ path: '/api/v1/commercial/organizations', body: { name: 'SDK Org' } }),
      expect.objectContaining({ path: '/api/v1/commercial/organizations/org_caller/workspaces', body: { name: 'SDK Workspace', slug: 'sdk-workspace', region: 'us', local_workspace_id: undefined } }),
    ]);
  });

  it('maps hosted compute and artifact operations to scoped routes', async () => {
    const calls: unknown[] = [];
    const transport: CommercialTransport = {
      async request<T>(input: { readonly method: 'GET' | 'POST' | 'DELETE'; readonly path: string; readonly request_id: string; readonly idempotency_key?: string; readonly body?: unknown }) {
        calls.push(input);
        return { request_id: input.request_id, data: {} as T };
      },
    };
    const client = new CommercialSdkClient(transport);
    await client.submitCompute('sdk-compute-1', {
      organization_id: 'org_sdk', workspace_id: 'cws_sdk', provider_id: 'compute_sdk', region_id: 'region_sdk', job_class_id: 'jobclass_sdk',
      requested_seconds: 2,
    });
    await client.putArtifact('sdk-artifact-1', {
      organization_id: 'org_sdk', workspace_id: 'cws_sdk', name: 'output.txt', media_type: 'text/plain', bytes: new Uint8Array([1, 2, 3]),
    });
    await client.issueArtifactDownload('sdk-download-1', 'org_sdk', 'cws_sdk', 'hartifact_sdk', '2026-08-12T12:00:00.000Z');
    expect(calls).toEqual([
      expect.objectContaining({ path: '/api/v1/commercial/organizations/org_sdk/workspaces/cws_sdk/compute', idempotency_key: 'sdk-compute-1' }),
      expect.objectContaining({ path: '/api/v1/commercial/organizations/org_sdk/workspaces/cws_sdk/artifacts', body: { name: 'output.txt', media_type: 'text/plain', run_id: undefined, retention_policy_id: undefined, bytes_base64: 'AQID' } }),
      expect.objectContaining({ path: '/api/v1/commercial/organizations/org_sdk/workspaces/cws_sdk/artifacts/hartifact_sdk/download?expires_at=2026-08-12T12%3A00%3A00.000Z' }),
    ]);
  });
});
