import { organizationKey, parseEventEnvelope } from './validation';
import {
  CloudflareR2ArtifactStore,
  CloudflareEventHistoryStore,
  CloudflareHyperdriveDatabaseAdapter,
  HyperdriveSqlClient,
} from './cloudflare';
import { artifactIdSchema, organizationIdSchema, workspaceIdSchema } from '@spiderbyte/commercial-domain';
import { HmacArtifactDownloadSigner } from './signing';

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
  if (env.HYPERDRIVE?.connectionString === undefined) throw new Error('HYPERDRIVE binding is required for durable event history');
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
  if (env.HYPERDRIVE?.connectionString === undefined || env.ARTIFACTS === undefined) {
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
    bindingCapability('hosted_database', env.HYPERDRIVE?.connectionString !== undefined, 'HYPERDRIVE'),
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
    {
      capability: 'identity',
      availability: hasSecret(env, 'CLERK_SECRET_KEY') ? 'not_implemented' : 'not_configured',
      adapter: 'clerk-identity-pending-runtime-wiring',
      reason: hasSecret(env, 'CLERK_SECRET_KEY')
        ? 'Clerk secret is present, but token verification and synchronized resource authorization are not yet wired into this Worker'
        : 'CLERK_SECRET_KEY is not configured',
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
  readonly availability: 'available' | 'not_configured' | 'not_implemented';
  readonly adapter: string;
  readonly reason: string;
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
  return typeof (env as unknown as Record<string, unknown>)[name] === 'string';
}

function stringEnv(env: Env, name: string): string | undefined {
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : undefined;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
