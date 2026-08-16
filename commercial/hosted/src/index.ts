import { organizationKey, parseEventEnvelope } from './validation';
import {
  CloudflareR2ArtifactStore,
  CloudflareEventHistoryStore,
  CloudflareHyperdriveDatabaseAdapter,
  HyperdriveSqlClient,
} from './cloudflare';
import { ClerkIdentityAdapter, MonotonicIdGenerator, SecureTokenGenerator } from '@spiderbyte/commercial-adapters';
import { CommercialDirectoryService } from '@spiderbyte/commercial-application';
import {
  accountIdSchema,
  artifactIdSchema,
  nowIsoDateTime,
  organizationIdSchema,
  workspaceIdSchema,
  type AccountId,
  type Principal,
} from '@spiderbyte/commercial-domain';
import { SqlAuditWriter } from '@spiderbyte/commercial-persistence';
import { CapabilityUnavailableError } from '@spiderbyte/commercial-ports';
import type { ExternalIdentityOrganizationSnapshot } from '@spiderbyte/commercial-ports';
import { HmacArtifactDownloadSigner } from './signing';
import {
  parsePlatformProjectWorkspaceBindings,
  platformProjectWorkspaceBindingCapability,
  type PlatformProjectWorkspaceBinding,
} from './platform-binding';

export { CloudflareEventHistoryStore, CloudflareHyperdriveDatabaseAdapter, CloudflareObservabilityProvider, CloudflareQueueEventBus, CloudflareR2ArtifactStore, CloudflareWorkflowAdapter, HyperdriveSqlClient, UnavailableSecretsProvider } from './cloudflare';
export { HmacArtifactDownloadSigner } from './signing';
export { RunEventsDurableObject } from './events';
export { RunOrchestrationWorkflow } from './workflow';
export {
  ModalExecutionAdapter,
  ModalWebFunctionTransport,
  OpenRouterLlmAdapter,
  OpenRouterProviderError,
} from './providers';

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/api/v1/commercial/capabilities')) {
      return json({
        service: 'spiderbyte-commercial-hosted',
        environment: stringEnv(env, 'SPIDERBYTE_ENVIRONMENT') ?? 'unknown',
        capabilities: capabilities(env),
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/commercial/session') {
      return commercialSession(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/commercial/artifacts/download') {
      return downloadArtifact(url, env);
    }
    if (url.pathname.startsWith('/api/v1/commercial/runs/') && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return json({
        error: {
          code: hasSecret(env, 'CLERK_SECRET_KEY') ? 'commercial.identity.not_implemented' : 'commercial.identity.not_configured',
          message: hasSecret(env, 'CLERK_SECRET_KEY')
            ? 'Clerk verification and resource authorization must be wired before accepting run WebSockets'
            : 'CLERK_SECRET_KEY is required before accepting run WebSockets',
        },
      }, 503);
    }
    return json({ error: { code: 'not_found', message: 'hosted route not found' } }, 404);
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      if (batch.queue === 'spiderbyte-commercial-events') {
        await deliverEvent(env, parseEventEnvelope(message.body));
        continue;
      }
      if (batch.queue === 'spiderbyte-commercial-dispatch') {
        throw new Error(`managed execution adapter is not configured for dispatch message ${message.id}`);
      }
      throw new Error(`unexpected commercial queue ${batch.queue}`);
    }
  },
} satisfies ExportedHandler<Env, unknown>;

export default worker;

async function deliverEvent(env: Env, event: ReturnType<typeof parseEventEnvelope>): Promise<void> {
  if (!hasHyperdrive(env)) throw new Error('HYPERDRIVE binding is required for durable event history');
  const database = new CloudflareHyperdriveDatabaseAdapter(env.HYPERDRIVE);
  await database.open();
  const history = new CloudflareEventHistoryStore(new HyperdriveSqlClient(env.HYPERDRIVE));
  const stored = await history.append(event);
  const namespace = env.RUN_EVENTS;
  if (namespace === undefined) throw new Error('RUN_EVENTS Durable Object binding is not configured');
  const id = namespace.idFromName(organizationKey(event));
  const response = await namespace.get(id).fetch('https://spiderbyte.internal/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(stored),
  });
  if (!response.ok) throw new Error(`Durable Object event persistence failed with status ${response.status}`);
}

async function downloadArtifact(url: URL, env: Env): Promise<Response> {
  const signingSecret = stringEnv(env, 'ARTIFACT_DOWNLOAD_SIGNING_SECRET');
  const publicOrigin = stringEnv(env, 'SPIDERBYTE_PUBLIC_ORIGIN');
  if (signingSecret === undefined || publicOrigin === undefined) {
    return json({ error: { code: 'commercial.hosted_artifacts.not_configured', message: 'artifact download signing is not configured' } }, 503);
  }
  let signer: HmacArtifactDownloadSigner;
  try {
    signer = new HmacArtifactDownloadSigner(signingSecret, publicOrigin);
  } catch {
    return json({ error: { code: 'commercial.hosted_artifacts.not_configured', message: 'artifact download signing configuration is invalid' } }, 503);
  }
  const organizationId = organizationIdSchema.safeParse(url.searchParams.get('organization_id'));
  const workspaceId = workspaceIdSchema.safeParse(url.searchParams.get('workspace_id'));
  const artifactId = artifactIdSchema.safeParse(url.searchParams.get('artifact_id'));
  const expires = url.searchParams.get('expires');
  const signature = url.searchParams.get('signature');
  if (!organizationId.success || !workspaceId.success || !artifactId.success || expires === null || signature === null) {
    return json({ error: { code: 'commercial.hosted_artifacts.invalid_download', message: 'artifact download parameters are invalid' } }, 400);
  }
  const valid = await signer.verify({
    path: '/api/v1/commercial/artifacts/download',
    organization_id: organizationId.data,
    workspace_id: workspaceId.data,
    artifact_id: artifactId.data,
    expires,
    signature,
  });
  if (!valid) return json({ error: { code: 'commercial.hosted_artifacts.invalid_download', message: 'artifact download signature is invalid or expired' } }, 403);
  if (!hasHyperdrive(env) || env.ARTIFACTS === undefined) {
    return json({ error: { code: 'commercial.hosted_artifacts.not_configured', message: 'artifact persistence is not configured' } }, 503);
  }
  const database = new CloudflareHyperdriveDatabaseAdapter(env.HYPERDRIVE);
  const store = await database.open();
  const artifact = await store.get('hosted_artifacts', artifactId.data);
  if (artifact === undefined || artifact.organization_id !== organizationId.data || artifact.workspace_id !== workspaceId.data || artifact.state !== 'available') {
    return json({ error: { code: 'not_found', message: 'artifact not found' } }, 404);
  }
  const object = await new CloudflareR2ArtifactStore(env.ARTIFACTS).getObject({
    organization_id: organizationId.data,
    workspace_id: workspaceId.data,
    object_ref: artifact.object_ref,
  });
  if (object === undefined) return json({ error: { code: 'not_found', message: 'artifact object not found' } }, 404);
  return new Response(object.body, {
    headers: {
      'cache-control': 'private, no-store',
      'content-type': object.media_type ?? artifact.media_type,
      'content-length': String(object.size_bytes),
      etag: `"${artifact.content_address}"`,
    },
  });
}

function capabilities(env: Env): readonly PublicCapability[] {
  return [
    bindingCapability('hosted_database', hasHyperdrive(env), 'HYPERDRIVE'),
    bindingCapability('hosted_artifacts', env.ARTIFACTS !== undefined, 'ARTIFACTS'),
    managedLlmCapability(env),
    bindingCapability('event_bus', env.EVENTS_QUEUE !== undefined, 'EVENTS_QUEUE'),
    bindingCapability('workflow_engine', env.RUN_ORCHESTRATION !== undefined, 'RUN_ORCHESTRATION'),
    {
      capability: 'observability',
      availability: 'available',
      adapter: 'cloudflare-observability',
      reason: 'Worker observability is enabled in wrangler.jsonc',
    },
    identityCapability(env),
    hostedPlatformBindingCapability(env),
    hostedProjectWorkspaceBindingCapability(env),
    {
      capability: 'billing',
      availability: hasSecret(env, 'CLERK_SECRET_KEY') ? 'not_implemented' : 'not_configured',
      adapter: 'clerk-billing-presentation-only',
      reason: hasSecret(env, 'CLERK_SECRET_KEY')
        ? 'Clerk billing presentation may be configured, but webhook reconciliation and SpiderByte entitlement enforcement are not wired into this Worker'
        : 'CLERK_SECRET_KEY is not configured for hosted billing reconciliation',
    },
    {
      capability: 'entitlements',
      availability: 'not_implemented',
      adapter: 'commercial-billing-pending-runtime-wiring',
      reason: 'Entitlement checks must be connected to the same authorized application services used by web, API, SDK, MCP, ACP, and CLI clients',
    },
    {
      capability: 'secrets',
      availability: 'not_configured',
      adapter: 'unavailable-secrets',
      reason: 'customer-managed SecretRef resolution is not configured',
    },
    {
      capability: 'hosted_compute',
      availability: 'not_configured',
      adapter: 'modal-runtime-pending',
      reason: 'Modal execution adapter and provider credential are not configured',
    },
  ];
}

interface PublicCapability {
  readonly capability: string;
  readonly availability: 'available' | 'not_included' | 'not_configured' | 'temporarily_unavailable' | 'not_implemented';
  readonly adapter: string;
  readonly reason: string;
}

interface HostedCommercialRuntime {
  readonly directory: CommercialDirectoryService;
  readonly identity: ClerkIdentityAdapter;
  readonly store: Awaited<ReturnType<CloudflareHyperdriveDatabaseAdapter['open']>>;
}

async function commercialSession(request: Request, env: Env): Promise<Response> {
  const token = bearerToken(request.headers.get('authorization'));
  if (token === undefined) return json({ error: { code: 'commercial.authentication_required', message: 'a hosted bearer session is required' } }, 401);

  let runtime: HostedCommercialRuntime;
  try {
    runtime = await openCommercialRuntime(env);
  } catch (error) {
    return json({ error: { code: errorCode(error, 'commercial.hosted_database.not_configured'), message: errorMessage(error, 'hosted commercial identity is not configured') } }, 503);
  }
  let principal: Principal | undefined;
  try {
    principal = await runtime.directory.validateSession(token);
  } catch (error) {
    return json({ error: { code: errorCode(error, 'commercial.invalid_session'), message: errorMessage(error, 'hosted session validation failed') } }, 503);
  }
  if (principal === undefined) return json({ error: { code: 'commercial.invalid_session', message: 'hosted session is invalid, expired, or not a synchronized organization member' } }, 401);

  try {
    await synchronizePlatformOrganizations(runtime, principal, env);
  } catch (error) {
    return json({
      error: {
        code: errorCode(error, 'commercial.platform_binding.unavailable'),
        message: errorMessage(error, 'hosted platform organization binding is unavailable'),
      },
    }, 503);
  }

  const organizations = (await runtime.store.list('organizations'))
    .filter((organization) => organization.account_id === principal.account_id && principal.organization_ids.includes(organization.id))
    .map((organization) => ({
      id: organization.id,
      account_id: organization.account_id,
      name: organization.name,
      state: organization.state,
    }));
  return json({ principal, organizations });
}

async function synchronizePlatformOrganizations(
  runtime: HostedCommercialRuntime,
  principal: Principal,
  env: Env,
): Promise<void> {
  const platformUrl = stringEnv(env, 'SPIDERBYTE_PLATFORM_SYNC_URL')?.replace(/\/+$/, '');
  const platformToken = stringEnv(env, 'SPIDERBYTE_PLATFORM_SYNC_TOKEN');
  const syncSecret = stringEnv(env, 'SPIDERBYTE_PLATFORM_SYNC_SECRET');
  let bindings: readonly PlatformProjectWorkspaceBinding[];
  try {
    bindings = parsePlatformProjectWorkspaceBindings(
      stringEnv(env, 'SPIDERBYTE_PLATFORM_PROJECT_WORKSPACE_BINDINGS_JSON'),
    );
  } catch (error) {
    throw new CapabilityUnavailableError({
      capability: 'platform_project_workspace_binding',
      availability: 'not_configured',
      adapter: 'kap-server-hosted-project-workspace-binding',
      reason: error instanceof Error ? error.message : 'platform project/workspace binding configuration is invalid',
      checked_at: nowIsoDateTime(),
    });
  }
  const required = isTruthyEnv(env, 'SPIDERBYTE_REQUIRE_PLATFORM_IDENTITY_BINDING') || bindings.length > 0;
  if (platformUrl === undefined && platformToken === undefined && syncSecret === undefined && !required) return;
  if (platformUrl === undefined || platformToken === undefined || syncSecret === undefined) {
    throw new CapabilityUnavailableError({
      capability: 'platform_identity_binding',
      availability: 'not_configured',
      adapter: 'kap-server-hosted-organization-sync',
      reason: 'SPIDERBYTE_PLATFORM_SYNC_URL, SPIDERBYTE_PLATFORM_SYNC_TOKEN, and SPIDERBYTE_PLATFORM_SYNC_SECRET are required together when platform identity binding is required',
      checked_at: nowIsoDateTime(),
    });
  }

  const snapshots = await runtime.identity.listOrganizationSnapshots(principal);
  for (const snapshot of snapshots) {
    const requestId = await hostedSyncRequestId(snapshot);
    const response = await fetch(`${platformUrl}/api/v2/internal/organizations/sync`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${platformToken}`,
        'content-type': 'application/json',
        'x-spiderbyte-hosted-sync-secret': syncSecret,
      },
      body: JSON.stringify({
        request_id: requestId,
        organization_id: snapshot.organization_id,
        name: snapshot.name,
        mode: 'hosted',
        members: snapshot.members
          .filter((member) => member.state === 'active')
          .map((member) => ({
            member_id: member.user_id,
            role: platformRole(member.role),
          })),
      }),
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok || !isSuccessfulPlatformEnvelope(payload)) {
      throw new Error('kap-server rejected hosted organization synchronization');
    }
    for (const binding of bindings.filter((candidate) => candidate.organization_id === snapshot.organization_id)) {
      const bindingResponse = await fetch(
        `${platformUrl}/api/v2/internal/projects/${encodeURIComponent(binding.project_id)}/workspaces/bind`,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${platformToken}`,
            'content-type': 'application/json',
            'x-spiderbyte-hosted-sync-secret': syncSecret,
          },
          body: JSON.stringify({
            request_id: await hostedBindingRequestId(snapshot, binding),
            organization_id: binding.organization_id,
            project_id: binding.project_id,
            workspace_id: binding.workspace_id,
            owner_member_id: snapshot.owner_user_id,
          }),
        },
      );
      const bindingPayload = await bindingResponse.json().catch(() => undefined);
      if (!bindingResponse.ok || !isSuccessfulPlatformEnvelope(bindingPayload)) {
        throw new Error('kap-server rejected hosted project/workspace binding');
      }
    }
  }
}

function platformRole(role: ExternalIdentityOrganizationSnapshot['members'][number]['role']): 'organization_owner' | 'organization_administrator' | 'member' | 'viewer' {
  if (role === 'owner') return 'organization_owner';
  if (role === 'admin') return 'organization_administrator';
  return role;
}

async function hostedSyncRequestId(snapshot: ExternalIdentityOrganizationSnapshot): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `hosted_sync_${hex}`;
}

async function hostedBindingRequestId(
  snapshot: ExternalIdentityOrganizationSnapshot,
  binding: PlatformProjectWorkspaceBinding,
): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify({ snapshot, binding }));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `hosted_binding_${hex}`;
}

function isSuccessfulPlatformEnvelope(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'code' in value && (value as { readonly code?: unknown }).code === 0;
}

async function openCommercialRuntime(env: Env): Promise<HostedCommercialRuntime> {
  const identity = new ClerkIdentityAdapter({
    secretKey: stringEnv(env, 'CLERK_SECRET_KEY'),
    jwtKey: stringEnv(env, 'CLERK_JWT_KEY'),
    authorizedParties: csvEnv(env, 'CLERK_AUTHORIZED_PARTIES'),
    accountId: commercialAccountId(env),
  });
  const identityStatus = identity.capability();
  if (identityStatus.availability !== 'available') throw new CapabilityUnavailableError(identityStatus);

  const database = new CloudflareHyperdriveDatabaseAdapter(env.HYPERDRIVE);
  const store = await database.open();
  const directory = new CommercialDirectoryService({
    store,
    identity,
    audit: new SqlAuditWriter(new HyperdriveSqlClient(env.HYPERDRIVE)),
    clock: { now: nowIsoDateTime },
    ids: new MonotonicIdGenerator(),
    tokens: new SecureTokenGenerator(),
  });
  return { directory, identity, store };
}

function identityCapability(env: Env): PublicCapability {
  const identity = new ClerkIdentityAdapter({
    secretKey: stringEnv(env, 'CLERK_SECRET_KEY'),
    jwtKey: stringEnv(env, 'CLERK_JWT_KEY'),
    authorizedParties: csvEnv(env, 'CLERK_AUTHORIZED_PARTIES'),
    accountId: commercialAccountId(env),
  });
  const status = identity.capability();
  if (status.availability === 'available' && !hasHyperdrive(env)) {
    return {
      capability: 'identity',
      availability: 'not_configured',
      adapter: status.adapter ?? 'clerk-identity',
      reason: 'HYPERDRIVE is required to synchronize Clerk membership into SpiderByte commercial tenant records',
    };
  }
  return {
    capability: status.capability,
    availability: status.availability,
    adapter: status.adapter ?? 'clerk-identity',
    reason: status.reason,
  };
}

function hostedPlatformBindingCapability(env: Env): PublicCapability {
  const configured = [
    stringEnv(env, 'SPIDERBYTE_PLATFORM_SYNC_URL'),
    stringEnv(env, 'SPIDERBYTE_PLATFORM_SYNC_TOKEN'),
    stringEnv(env, 'SPIDERBYTE_PLATFORM_SYNC_SECRET'),
  ].every((value) => value !== undefined && value.length > 0);
  return {
    capability: 'platform_identity_binding',
    availability: configured ? 'available' : 'not_configured',
    adapter: 'kap-server-hosted-organization-sync',
    reason: configured
      ? 'Hosted Clerk organizations can be synchronized into kap-server platform authorization'
      : isTruthyEnv(env, 'SPIDERBYTE_REQUIRE_PLATFORM_IDENTITY_BINDING')
        ? 'Platform identity binding is required but its URL, bearer token, or shared secret is missing'
        : 'SPIDERBYTE_PLATFORM_SYNC_URL, SPIDERBYTE_PLATFORM_SYNC_TOKEN, and SPIDERBYTE_PLATFORM_SYNC_SECRET are required',
  };
}

function hostedProjectWorkspaceBindingCapability(env: Env): PublicCapability {
  const bridgeConfigured = [
    stringEnv(env, 'SPIDERBYTE_PLATFORM_SYNC_URL'),
    stringEnv(env, 'SPIDERBYTE_PLATFORM_SYNC_TOKEN'),
    stringEnv(env, 'SPIDERBYTE_PLATFORM_SYNC_SECRET'),
  ].every((value) => value !== undefined && value.length > 0);
  return platformProjectWorkspaceBindingCapability(
    bridgeConfigured,
    stringEnv(env, 'SPIDERBYTE_PLATFORM_PROJECT_WORKSPACE_BINDINGS_JSON'),
  );
}

function commercialAccountId(env: Env): AccountId | undefined {
  const parsed = accountIdSchema.safeParse(stringEnv(env, 'SPIDERBYTE_COMMERCIAL_ACCOUNT_ID'));
  return parsed.success ? parsed.data : undefined;
}

function csvEnv(env: Env, name: string): readonly string[] | undefined {
  const value = stringEnv(env, name);
  if (value === undefined) return undefined;
  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  return entries.length === 0 ? undefined : entries;
}

function bearerToken(value: string | null): string | undefined {
  if (value === null) return undefined;
  const match = /^Bearer\s+(\S+)$/u.exec(value);
  return match?.[1];
}

function errorCode(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') return error.code;
  return fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

function bindingCapability(capability: string, configured: boolean, binding: string): PublicCapability {
  return {
    capability,
    availability: configured ? 'available' : 'not_configured',
    adapter: `cloudflare-${binding.toLowerCase()}`,
    reason: configured ? `${binding} binding is configured` : `${binding} binding is not configured`,
  };
}

function managedLlmCapability(env: Env): PublicCapability {
  const endpoint = stringEnv(env, 'OPENROUTER_AI_GATEWAY_ENDPOINT');
  const configured = endpoint !== undefined && /^https:\/\//iu.test(endpoint) && hasSecret(env, 'OPENROUTER_API_KEY');
  return {
    capability: 'managed_llm',
    availability: configured ? 'available' : 'not_configured',
    adapter: 'openrouter-through-cloudflare-ai-gateway',
    reason: configured
      ? 'OpenRouter AI Gateway endpoint and server-side credential are configured'
      : 'OPENROUTER_AI_GATEWAY_ENDPOINT and OPENROUTER_API_KEY are required',
  };
}

function hasSecret(env: Env, name: string): boolean {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0;
}

function hasHyperdrive(env: Env): boolean {
  const connectionString = env.HYPERDRIVE?.connectionString;
  return typeof connectionString === 'string' && connectionString.length > 0;
}

function stringEnv(env: Env, name: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

function isTruthyEnv(env: Env, name: string): boolean {
  const value = stringEnv(env, name);
  return value === '1' || value?.toLowerCase() === 'true';
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
