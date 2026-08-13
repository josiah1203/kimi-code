import { auth } from '@clerk/nextjs/server';

import { verifyCommercialSessionSync } from '@/lib/commercial-session-sync';
import { createClerkDelegatedPrincipalAssertion } from '@/lib/spiderbyte-delegated-principal';

export const runtime = 'nodejs';

/**
 * Issue a short-lived WebSocket subprotocol assertion for the already signed-in
 * browser. This is intentionally separate from the platform bearer token: the
 * browser never receives SPIDERBYTE_API_TOKEN, and kap-server still verifies
 * the assertion before authorizing a workspace subscription.
 */
export async function GET(): Promise<Response> {
  let session: Awaited<ReturnType<typeof auth>>;
  try {
    session = await auth();
  } catch {
    return Response.json(
      { code: 'identity_not_configured', message: 'Clerk identity verification is not configured.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
  if (!session.userId) {
    return Response.json(
      { code: 'authentication_required', message: 'Sign in before opening a SpiderByte realtime connection.' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    );
  }

  const secret = process.env['SPIDERBYTE_IDENTITY_BRIDGE_SECRET'];
  if (secret === undefined) {
    return Response.json(
      { code: 'identity_bridge_not_configured', message: 'The hosted identity bridge is not configured.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }

  if (process.env.SPIDERBYTE_REQUIRE_COMMERCIAL_SESSION_SYNC === '1') {
    const commercialApiBase = process.env.SPIDERBYTE_COMMERCIAL_API_URL?.replace(/\/+$/, '');
    const syncFailure = await verifyCommercialSessionSync(session, commercialApiBase);
    if (syncFailure !== undefined) return syncFailure;
  }

  try {
    const assertion = createClerkDelegatedPrincipalAssertion({
      userId: session.userId,
      organizationId: session.orgId ?? undefined,
      ttlMs: 30_000,
    }, secret);
    return Response.json(
      { assertion, expires_in_ms: 30_000 },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { code: 'identity_bridge_not_configured', message: 'The hosted identity bridge is not configured.' },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
