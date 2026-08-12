import type {
  CommercialApiEnvelope,
  CommercialApiErrorBody,
} from '@spiderbyte/commercial-api';
import type {
  CreateAccountInput,
  CreateOrganizationInput,
  CreateWorkspaceInput,
  IdentityProviderType,
} from '@spiderbyte/commercial-domain';

import { CommercialSdkError } from './errors';

export interface CommercialTransport {
  request<T>(input: {
    readonly method: 'GET' | 'POST' | 'DELETE';
    readonly path: string;
    readonly request_id: string;
    readonly idempotency_key?: string;
    readonly body?: unknown;
  }): Promise<CommercialApiEnvelope<T>>;
}

export interface FetchCommercialTransportOptions {
  readonly baseUrl: string;
  readonly getToken: () => string | undefined;
  readonly fetcher?: typeof fetch;
}

export class FetchCommercialTransport implements CommercialTransport {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: FetchCommercialTransportOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async request<T>(input: {
    readonly method: 'GET' | 'POST' | 'DELETE';
    readonly path: string;
    readonly request_id: string;
    readonly idempotency_key?: string;
    readonly body?: unknown;
  }): Promise<CommercialApiEnvelope<T>> {
    const token = this.options.getToken();
    const response = await this.fetcher(new URL(input.path, this.options.baseUrl), {
      method: input.method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Request-Id': input.request_id,
        ...(input.idempotency_key === undefined ? {} : { 'Idempotency-Key': input.idempotency_key }),
        ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
      },
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    });
    const envelope = await response.json() as CommercialApiEnvelope<T>;
    if (!response.ok || 'error' in envelope) {
      const error = 'error' in envelope ? envelope.error : { code: 'commercial.http_error', message: 'commercial request failed' } satisfies CommercialApiErrorBody;
      throw new CommercialSdkError(error.code, error.message, response.status, error.detail);
    }
    return envelope;
  }
}

export class CommercialSdkClient {
  constructor(private readonly transport: CommercialTransport) {}

  createAccount(request_id: string, input: CreateAccountInput): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({
      method: 'POST',
      path: '/api/v1/commercial/accounts',
      request_id,
      idempotency_key: input.request_id,
      body: { email: input.email, display_name: input.display_name, secret: input.secret },
    });
  }

  login(request_id: string, input: { readonly email: string; readonly secret: string }): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({ method: 'POST', path: '/api/v1/commercial/sessions', request_id, body: input });
  }

  createOrganization(request_id: string, input: CreateOrganizationInput): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({
      method: 'POST',
      path: '/api/v1/commercial/organizations',
      request_id,
      idempotency_key: input.request_id,
      body: { name: input.name },
    });
  }

  createWorkspace(request_id: string, input: CreateWorkspaceInput): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({
      method: 'POST',
      path: `/api/v1/commercial/organizations/${encodeURIComponent(input.organization_id)}/workspaces`,
      request_id,
      idempotency_key: input.request_id,
      body: {
        name: input.name,
        slug: input.slug,
        region: input.region,
        local_workspace_id: input.local_workspace_id,
      },
    });
  }

  entitlement(request_id: string, organizationId: string, key: string): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({ method: 'GET', path: `/api/v1/commercial/organizations/${encodeURIComponent(organizationId)}/entitlements/${encodeURIComponent(key)}`, request_id });
  }

  submitCompute(request_id: string, input: {
    readonly organization_id: string;
    readonly workspace_id: string;
    readonly provider_id: string;
    readonly region_id: string;
    readonly job_class_id: string;
    readonly run_id?: string;
    readonly attempt_id?: string;
    readonly requested_seconds: number;
    readonly timeout_at?: string;
  }): Promise<CommercialApiEnvelope<unknown>> {
    const { organization_id, workspace_id, ...body } = input;
    return this.transport.request({
      method: 'POST',
      path: `/api/v1/commercial/organizations/${encodeURIComponent(organization_id)}/workspaces/${encodeURIComponent(workspace_id)}/compute`,
      request_id,
      idempotency_key: request_id,
      body,
    });
  }

  refreshCompute(request_id: string, organizationId: string, workspaceId: string, executionId: string): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({
      method: 'GET',
      path: `/api/v1/commercial/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}/compute/executions/${encodeURIComponent(executionId)}`,
      request_id,
    });
  }

  cancelCompute(request_id: string, organizationId: string, workspaceId: string, executionId: string): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({
      method: 'POST',
      path: `/api/v1/commercial/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}/compute/executions/${encodeURIComponent(executionId)}/cancel`,
      request_id,
      idempotency_key: request_id,
    });
  }

  putArtifact(request_id: string, input: {
    readonly organization_id: string;
    readonly workspace_id: string;
    readonly run_id?: string;
    readonly name: string;
    readonly media_type: string;
    readonly bytes: Uint8Array;
    readonly retention_policy_id?: string;
  }): Promise<CommercialApiEnvelope<unknown>> {
    const { organization_id, workspace_id, bytes, name, media_type, run_id, retention_policy_id } = input;
    return this.transport.request({
      method: 'POST',
      path: `/api/v1/commercial/organizations/${encodeURIComponent(organization_id)}/workspaces/${encodeURIComponent(workspace_id)}/artifacts`,
      request_id,
      idempotency_key: request_id,
      body: { name, media_type, run_id, retention_policy_id, bytes_base64: bytesToBase64(bytes) },
    });
  }

  issueArtifactDownload(request_id: string, organizationId: string, workspaceId: string, artifactId: string, expiresAt: string): Promise<CommercialApiEnvelope<unknown>> {
    const query = new URLSearchParams({ expires_at: expiresAt });
    return this.transport.request({
      method: 'GET',
      path: `/api/v1/commercial/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}/download?${query.toString()}`,
      request_id,
    });
  }

  deleteArtifact(request_id: string, organizationId: string, workspaceId: string, artifactId: string): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({
      method: 'DELETE',
      path: `/api/v1/commercial/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}`,
      request_id,
      idempotency_key: request_id,
    });
  }

  createTeam(request_id: string, organizationId: string, input: { readonly name: string; readonly workspace_ids?: readonly string[] }): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({ method: 'POST', path: `/api/v1/commercial/organizations/${encodeURIComponent(organizationId)}/teams`, request_id, idempotency_key: request_id, body: input });
  }

  createCustomRole(request_id: string, organizationId: string, input: { readonly name: string; readonly permission_keys: readonly string[] }): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({ method: 'POST', path: `/api/v1/commercial/organizations/${encodeURIComponent(organizationId)}/roles`, request_id, idempotency_key: request_id, body: input });
  }

  configureIdentityProvider(request_id: string, organizationId: string, input: { readonly type: IdentityProviderType; readonly issuer?: string; readonly entity_id?: string; readonly client_id?: string }): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({ method: 'POST', path: `/api/v1/commercial/organizations/${encodeURIComponent(organizationId)}/enterprise/identity-providers`, request_id, idempotency_key: request_id, body: input });
  }

  configureEnterprise(request_id: string, organizationId: string, input: Record<string, unknown>): Promise<CommercialApiEnvelope<unknown>> {
    return this.transport.request({ method: 'POST', path: `/api/v1/commercial/organizations/${encodeURIComponent(organizationId)}/enterprise/configuration`, request_id, idempotency_key: request_id, body: input });
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary);
}
