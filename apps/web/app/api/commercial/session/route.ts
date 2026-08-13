import { auth } from '@clerk/nextjs/server';

export const runtime = 'nodejs';

/**
 * Forward the verified Clerk bearer token to the hosted commercial boundary.
 * The browser never receives a server credential and the Worker remains the
 * authority for membership synchronization and tenant authorization.
 */
export async function GET(): Promise<Response> {
  let session: Awaited<ReturnType<typeof auth>>;
  try {
    session = await auth();
  } catch {
    return error(503, 'identity_not_configured', 'Clerk identity verification is not configured for this web deployment.');
  }
  if (!session.userId) return error(401, 'authentication_required', 'Sign in before reading commercial session state.');

  let token: string | null;
  try {
    token = await session.getToken();
  } catch {
    return error(503, 'identity_not_configured', 'Clerk could not issue a server-side session token.');
  }
  if (token === null) return error(401, 'authentication_required', 'Clerk did not issue a session token.');

  const base = process.env.SPIDERBYTE_COMMERCIAL_API_URL?.replace(/\/+$/, '');
  if (!base) return error(503, 'commercial_not_configured', 'SPIDERBYTE_COMMERCIAL_API_URL is not configured.');

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/v1/commercial/session`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch {
    return error(503, 'commercial_unreachable', 'The hosted commercial boundary could not be reached.');
  }

  const headers = new Headers({ 'cache-control': 'no-store' });
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  return new Response(upstream.body, { status: upstream.status, headers });
}

function error(status: number, code: string, message: string): Response {
  return Response.json({ code, message }, { status, headers: { 'cache-control': 'no-store' } });
}
