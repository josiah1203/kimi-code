import { auth } from '@clerk/nextjs/server';

import { verifyCommercialSessionSync } from './commercial-session-sync';
import { createClerkDelegatedPrincipalAssertion } from './spiderbyte-delegated-principal';
import { decideBffAuthorization } from './spiderbyte-bff-policy';

const FORWARDED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

type ApiVersion = 'v1' | 'v2';

interface RouteParams {
  readonly path: string[];
}

/**
 * Forward only the browser-safe REST surface to SpiderByte Agent Core.
 *
 * This boundary deliberately does not import the runtime, a database client,
 * or a commercial adapter. Clerk establishes the hosted principal here; the
 * upstream SpiderByte service remains responsible for resource authorization,
 * budgets, entitlements, and audit decisions.
 */
export async function proxySpiderByteRequest(
  request: Request,
  version: ApiVersion,
  params: Promise<RouteParams>,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (!FORWARDED_METHODS.has(method)) {
    return jsonError(405, 'method_not_allowed', 'This method is not available through the SpiderByte web boundary.');
  }

  const { path } = await params;
  let session: Awaited<ReturnType<typeof auth>>;
  try {
    session = await auth();
  } catch {
    return jsonError(503, 'identity_not_configured', 'Clerk identity verification is not configured for this web deployment.');
  }
  const identityBridgeSecret = process.env.SPIDERBYTE_IDENTITY_BRIDGE_SECRET;
  const commercialApiBase = process.env.SPIDERBYTE_COMMERCIAL_API_URL?.replace(/\/+$/, '');
  const decision = decideBffAuthorization({
    path,
    hasVerifiedClerkPrincipal: Boolean(session.userId),
    hasServerPlatformCredential: Boolean(process.env.SPIDERBYTE_API_TOKEN),
    requiresIdentityBridge: process.env.SPIDERBYTE_REQUIRE_IDENTITY_BRIDGE === '1',
    hasIdentityBridgeSecret: Boolean(identityBridgeSecret),
    requiresCommercialSessionSync: process.env.SPIDERBYTE_REQUIRE_COMMERCIAL_SESSION_SYNC === '1',
    hasCommercialSessionSyncEndpoint: commercialApiBase !== undefined,
  });
  if (!decision.allowed) {
    const messages: Readonly<Record<string, string>> = {
      authentication_required: 'Sign in before accessing SpiderByte platform data.',
      platform_auth_not_configured: 'SPIDERBYTE_API_TOKEN is not configured for the SpiderByte upstream.',
      identity_bridge_not_configured: 'The hosted identity bridge is not configured for this web deployment.',
      commercial_session_sync_not_configured: 'The hosted commercial membership sync endpoint is not configured for this web deployment.',
      route_not_found: 'The requested SpiderByte route is not exposed to browser clients.',
    };
    return jsonError(decision.status, decision.code, messages[decision.code] ?? 'The request was rejected.');
  }
  const token = process.env.SPIDERBYTE_API_TOKEN as string;

  const upstreamBase = process.env.SPIDERBYTE_API_URL?.replace(/\/+$/, '');
  if (!upstreamBase) {
    return jsonError(503, 'platform_not_configured', 'SPIDERBYTE_API_URL is not configured for this web deployment.');
  }

  if (process.env.SPIDERBYTE_REQUIRE_COMMERCIAL_SESSION_SYNC === '1') {
    const syncFailure = await verifyCommercialSessionSync(session, commercialApiBase);
    if (syncFailure !== undefined) return syncFailure;
  }

  const pathSuffix = path.map(encodeURIComponent).join('/');
  const upstreamUrl = `${upstreamBase}/api/${version}/${pathSuffix}${new URL(request.url).search}`;
  const headers = new Headers({
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  });
  if (identityBridgeSecret !== undefined) {
    try {
      headers.set(
        'x-spiderbyte-delegated-principal',
        createClerkDelegatedPrincipalAssertion({
          userId: session.userId as string,
          organizationId: session.orgId ?? undefined,
        }, identityBridgeSecret),
      );
    } catch {
      return jsonError(503, 'identity_bridge_not_configured', 'The hosted identity bridge is not configured for this web deployment.');
    }
  }
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  let body: ArrayBuffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') body = await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method,
      headers,
      body,
      cache: 'no-store',
    });
  } catch {
    return jsonError(503, 'platform_unreachable', 'SpiderByte is not reachable from the web server.');
  }

  const responseHeaders = new Headers();
  const responseContentType = upstream.headers.get('content-type');
  if (responseContentType) responseHeaders.set('content-type', responseContentType);
  responseHeaders.set('cache-control', 'no-store');
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    {
      code,
      message,
    },
    {
      status,
      headers: { 'cache-control': 'no-store' },
    },
  );
}
