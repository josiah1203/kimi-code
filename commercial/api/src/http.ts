import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  createAccountInputSchema,
  emailSchema,
  identityProviderTypeSchema,
  isoDateTimeSchema,
  type ActorRef,
  type Principal,
} from '@spiderbyte/commercial-domain';
import type { CommercialDirectoryService } from '@spiderbyte/commercial-application';

import { CommercialApiApplication } from './application';
import { CommercialAuthMiddleware } from './auth';
import {
  commercialApiStatusForCode,
  mapCommercialApiError,
} from './errors';
import type { CommercialApiEnvelope, CommercialMutationHeaders } from './contracts';

const accountBodySchema = createAccountInputSchema.omit({ request_id: true, actor: true });
const loginBodySchema = z.strictObject({ email: emailSchema, secret: z.string().min(12).max(4096) });
const organizationBodySchema = z.strictObject({ name: z.string().trim().min(1).max(200) });
const workspaceBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
  region: z.string().trim().min(1).max(100).optional(),
  local_workspace_id: z.string().min(1).max(256).optional(),
});
const computeBodySchema = z.strictObject({
  provider_id: z.string().min(1).max(160),
  region_id: z.string().min(1).max(160),
  job_class_id: z.string().min(1).max(160),
  run_id: z.string().min(1).max(256).optional(),
  attempt_id: z.string().min(1).max(256).optional(),
  requested_seconds: z.number().finite().positive(),
  timeout_at: isoDateTimeSchema.optional(),
});
const artifactBodySchema = z.strictObject({
  run_id: z.string().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(500),
  media_type: z.string().trim().min(1).max(200),
  bytes_base64: z.string().max(67_108_864),
  retention_policy_id: z.string().min(1).max(160).optional(),
});
const teamBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  workspace_ids: z.array(z.string().min(1).max(160)).max(1000).optional(),
});
const customRoleBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  permission_keys: z.array(z.string().min(1).max(200)).min(1).max(100),
});
const identityProviderBodySchema = z.strictObject({
  type: identityProviderTypeSchema,
  issuer: z.string().url().optional(),
  entity_id: z.string().min(1).max(1000).optional(),
  client_id: z.string().min(1).max(500).optional(),
});
const enterpriseConfigurationBodySchema = z.strictObject({
  identity_provider_id: z.string().min(1).max(160).optional(),
  verified_domain_ids: z.array(z.string().min(1).max(160)).max(1000).optional(),
  group_role_mappings: z.record(z.string().min(1).max(500), z.array(z.string().min(1).max(160))).optional(),
  enforced_sso: z.boolean(),
  mfa_required: z.boolean().optional(),
  ip_allowlist: z.array(z.string().min(1).max(100)).max(1000).optional(),
  api_restrictions: z.array(z.string().min(1).max(200)).max(1000).optional(),
  data_residency: z.string().min(1).max(100).optional(),
  encryption_mode: z.enum(['platform_managed', 'customer_managed']).optional(),
  kms_key_ref: z.string().min(1).max(500).optional(),
  private_network_ref: z.string().min(1).max(500).optional(),
  deployment_mode: z.enum(['shared', 'regional', 'dedicated']),
  release_channel: z.enum(['stable', 'preview', 'pinned']),
});

export interface CommercialFastifyRouteDependencies {
  readonly application: CommercialApiApplication;
  readonly auth: CommercialAuthMiddleware;
  readonly directory: CommercialDirectoryService;
  readonly prefix?: string;
}

type RequestWithBody = FastifyRequest<{ Body: unknown }>;
type RequestWithEntitlement = FastifyRequest<{ Params: { organizationId: string; key: string } }>;
type RequestWithWorkspace = FastifyRequest<{ Params: { organizationId: string } }>;
type RequestWithWorkspaceScope = FastifyRequest<{ Params: { organizationId: string; workspaceId: string } }>;
type RequestWithExecution = FastifyRequest<{ Params: { organizationId: string; workspaceId: string; executionId: string } }>;
type RequestWithArtifact = FastifyRequest<{ Params: { organizationId: string; workspaceId: string; artifactId: string }; Querystring: { expires_at?: string } }>;
type RequestWithOrganization = FastifyRequest<{ Params: { organizationId: string } }>;

export async function registerCommercialFastifyRoutes(
  app: FastifyInstance,
  dependencies: CommercialFastifyRouteDependencies,
): Promise<void> {
  const prefix = dependencies.prefix ?? '/api/v1/commercial';

  app.post(`${prefix}/accounts`, async (request, reply) => respond(reply, request, async (headers) => {
    const body = accountBodySchema.parse((request as RequestWithBody).body);
    return dependencies.application.createAccount(headers, {
      ...body,
      request_id: commandRequestId(headers),
      actor: { kind: 'system', id: 'commercial-http' },
    });
  }));

  app.post(`${prefix}/sessions`, async (request, reply) => respond(reply, request, async (headers) => {
    const body = loginBodySchema.parse((request as RequestWithBody).body);
    return dependencies.application.login(headers, body);
  }));

  app.post(`${prefix}/organizations`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const body = organizationBodySchema.parse((request as RequestWithBody).body);
    return dependencies.application.createOrganization(headers, context.principal, {
      ...body,
      request_id: commandRequestId(headers),
      actor: actorForPrincipal(context.principal),
    });
  }));

  app.post(`${prefix}/organizations/:organizationId/workspaces`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const body = workspaceBodySchema.parse((request as RequestWithBody).body);
    const params = (request as RequestWithWorkspace).params;
    return dependencies.application.createWorkspace(headers, context.principal, {
      organization_id: params.organizationId,
      ...body,
      region: body.region ?? 'local',
      request_id: commandRequestId(headers),
      actor: actorForPrincipal(context.principal),
    });
  }));

  app.post(`${prefix}/organizations/:organizationId/workspaces/:workspaceId/compute`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const params = (request as RequestWithWorkspaceScope).params;
    const body = computeBodySchema.parse((request as RequestWithBody).body);
    return dependencies.application.submitCompute(headers, context.principal, { ...paramsToWorkspaceScope(params), ...body });
  }));

  app.get(`${prefix}/organizations/:organizationId/workspaces/:workspaceId/compute/executions/:executionId`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const params = (request as RequestWithExecution).params;
    return dependencies.application.refreshCompute(headers, context.principal, params.organizationId, params.workspaceId, params.executionId);
  }));

  app.post(`${prefix}/organizations/:organizationId/workspaces/:workspaceId/compute/executions/:executionId/cancel`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const params = (request as RequestWithExecution).params;
    return dependencies.application.cancelCompute(headers, context.principal, params.organizationId, params.workspaceId, params.executionId);
  }));

  app.post(`${prefix}/organizations/:organizationId/workspaces/:workspaceId/artifacts`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const params = (request as RequestWithWorkspaceScope).params;
    const body = artifactBodySchema.parse((request as RequestWithBody).body);
    const { bytes_base64, ...artifactBody } = body;
    return dependencies.application.putArtifact(headers, context.principal, {
      ...paramsToWorkspaceScope(params),
      ...artifactBody,
      bytes: decodeBase64(bytes_base64),
    });
  }));

  app.get(`${prefix}/organizations/:organizationId/workspaces/:workspaceId/artifacts/:artifactId/download`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const typed = request as RequestWithArtifact;
    const params = typed.params;
    const expiresAt = isoDateTimeSchema.parse(typed.query.expires_at);
    return dependencies.application.issueArtifactDownload(headers, context.principal, params.organizationId, params.workspaceId, params.artifactId, expiresAt);
  }));

  app.delete(`${prefix}/organizations/:organizationId/workspaces/:workspaceId/artifacts/:artifactId`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const params = (request as RequestWithArtifact).params;
    return dependencies.application.deleteArtifact(headers, context.principal, params.organizationId, params.workspaceId, params.artifactId);
  }));

  app.post(`${prefix}/organizations/:organizationId/teams`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const params = (request as RequestWithOrganization).params;
    const body = teamBodySchema.parse((request as RequestWithBody).body);
    return dependencies.application.createTeam(headers, context.principal, { organization_id: params.organizationId, ...body });
  }));

  app.post(`${prefix}/organizations/:organizationId/roles`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const params = (request as RequestWithOrganization).params;
    const body = customRoleBodySchema.parse((request as RequestWithBody).body);
    return dependencies.application.createCustomRole(headers, context.principal, { organization_id: params.organizationId, ...body });
  }));

  app.post(`${prefix}/organizations/:organizationId/enterprise/identity-providers`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const params = (request as RequestWithOrganization).params;
    const body = identityProviderBodySchema.parse((request as RequestWithBody).body);
    return dependencies.application.configureIdentityProvider(headers, context.principal, { organization_id: params.organizationId, ...body });
  }));

  app.post(`${prefix}/organizations/:organizationId/enterprise/configuration`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const params = (request as RequestWithOrganization).params;
    const body = enterpriseConfigurationBodySchema.parse((request as RequestWithBody).body);
    return dependencies.application.configureEnterprise(headers, context.principal, { organization_id: params.organizationId, ...body });
  }));

  app.get(`${prefix}/organizations/:organizationId/entitlements/:key`, async (request, reply) => respond(reply, request, async (headers) => {
    const context = await dependencies.auth.authenticate({ request_id: headers.request_id, headers: request.headers });
    const params = (request as RequestWithEntitlement).params;
    return dependencies.application.entitlement(headers, context.principal, params.organizationId, params.key);
  }));

}

async function respond<T>(
  reply: FastifyReply,
  request: FastifyRequest,
  operation: (headers: CommercialMutationHeaders) => Promise<CommercialApiEnvelope<T>>,
): Promise<void> {
  const request_id = requestId(request);
  try {
    const headers: CommercialMutationHeaders = {
      request_id,
      idempotency_key: headerValue(request.headers['idempotency-key']),
    };
    const result = await operation(headers);
    reply.code('error' in result ? commercialApiStatusForCode(result.error.code) : 200).send(result);
  } catch (error) {
    const mapped = mapCommercialApiError(error);
    reply.code(mapped.status).send({
      request_id,
      error: { code: mapped.code, message: mapped.message, detail: mapped.detail },
    });
  }
}

function requestId(request: FastifyRequest): string {
  const value = request.headers['x-request-id'];
  const header = Array.isArray(value) ? value[0] : value;
  return header ?? `req_${randomUUID().replaceAll('-', '')}`;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function commandRequestId(headers: CommercialMutationHeaders): string {
  return headers.idempotency_key ?? headers.request_id;
}

function actorForPrincipal(principal: Principal): ActorRef {
  if (principal.user_id !== undefined) return { kind: 'user', id: principal.user_id };
  return { kind: 'service_account', id: principal.service_account_id ?? principal.subject_id };
}

function paramsToWorkspaceScope(params: { readonly organizationId: string; readonly workspaceId: string }): { readonly organization_id: string; readonly workspace_id: string } {
  return { organization_id: params.organizationId, workspace_id: params.workspaceId };
}

function decodeBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('bytes_base64 must be canonical base64');
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
}
