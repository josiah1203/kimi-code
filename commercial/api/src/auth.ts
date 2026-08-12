import { principalSchema, type CommercialAction, type OrganizationId, type Principal, type WorkspaceId } from '@spiderbyte/commercial-domain';
import { CapabilityUnavailableError } from '@spiderbyte/commercial-ports';
import type { CommercialDirectoryService } from '@spiderbyte/commercial-application';

import { CommercialApiError } from './errors';

export interface HostedRequestLike {
  readonly request_id: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

export interface AuthenticatedRequestContext {
  readonly request_id: string;
  readonly principal: Principal;
}

export class CommercialAuthMiddleware {
  constructor(private readonly directory: CommercialDirectoryService) {}

  async authenticate(request: HostedRequestLike): Promise<AuthenticatedRequestContext> {
    const header = request.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (raw === undefined || !/^Bearer\s+\S+$/.test(raw)) {
      throw new CommercialApiError(401, 'commercial.authentication_required', 'a hosted bearer session is required');
    }
    const status = this.directory.capabilityStatus();
    if (status.availability !== 'available') throw new CapabilityUnavailableError(status);
    const token = raw.slice('Bearer '.length).trim();
    const principal = await this.directory.validateSession(token);
    if (principal === undefined) {
      throw new CommercialApiError(401, 'commercial.invalid_session', 'hosted session is invalid or expired');
    }
    return {
      request_id: request.request_id,
      principal: principalSchema.parse(principal),
    };
  }
}

export async function requireCommercialAuthorization(
  directory: CommercialDirectoryService,
  context: AuthenticatedRequestContext,
  organizationId: OrganizationId,
  action: CommercialAction,
  workspaceId?: WorkspaceId,
): Promise<void> {
  await directory.assertAuthorized(context.principal, organizationId, action, context.request_id, workspaceId);
}
