export type BffAuthorizationDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly status: 401 | 403 | 404 | 503; readonly code: string };

export interface BffAuthorizationInput {
  readonly path: readonly string[];
  readonly hasVerifiedClerkPrincipal: boolean;
  readonly hasServerPlatformCredential: boolean;
  readonly requiresIdentityBridge?: boolean;
  readonly hasIdentityBridgeSecret?: boolean;
  readonly requiresCommercialSessionSync?: boolean;
  readonly hasCommercialSessionSyncEndpoint?: boolean;
}

/**
 * Pure policy used by the Next.js BFF before any upstream request is made.
 * Resource membership and entitlements remain downstream SpiderByte decisions;
 * this layer only prevents route expansion and credential confusion.
 */
export function decideBffAuthorization(input: BffAuthorizationInput): BffAuthorizationDecision {
  if (!isAllowedSpiderBytePath(input.path)) {
    return { allowed: false, status: 404, code: 'route_not_found' };
  }
  if (!input.hasVerifiedClerkPrincipal) {
    return { allowed: false, status: 401, code: 'authentication_required' };
  }
  if (!input.hasServerPlatformCredential) {
    return { allowed: false, status: 503, code: 'platform_auth_not_configured' };
  }
  if (input.requiresIdentityBridge === true && input.hasIdentityBridgeSecret !== true) {
    return { allowed: false, status: 503, code: 'identity_bridge_not_configured' };
  }
  if (input.requiresCommercialSessionSync === true && input.hasCommercialSessionSyncEndpoint !== true) {
    return { allowed: false, status: 503, code: 'commercial_session_sync_not_configured' };
  }
  return { allowed: true };
}

export function isAllowedSpiderBytePath(path: readonly string[]): boolean {
  if (path.length === 0 || path.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) return false;
  return path[0] === 'workspaces' || path[0] === 'sessions' || path[0] === 'organizations' || path[0] === 'projects';
}
