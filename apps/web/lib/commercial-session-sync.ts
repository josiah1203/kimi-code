import { auth } from '@clerk/nextjs/server';

/**
 * Verify the Clerk session against the hosted commercial directory before a
 * server boundary issues a platform request or realtime assertion.
 *
 * The Worker performs membership synchronization and tenant checks. This
 * helper only returns an opaque failure response; it never forwards the
 * provider token to the browser or to kap-server.
 */
export async function verifyCommercialSessionSync(
  session: Awaited<ReturnType<typeof auth>>,
  commercialApiBase: string | undefined,
): Promise<Response | undefined> {
  if (commercialApiBase === undefined) {
    return jsonError(503, 'commercial_session_sync_not_configured', 'The hosted commercial membership sync endpoint is not configured for this web deployment.');
  }
  let token: string | null;
  try {
    token = await session.getToken();
  } catch {
    return jsonError(503, 'commercial_session_sync_unavailable', 'Clerk could not issue a server-side session token for commercial authorization.');
  }
  if (token === null) {
    return jsonError(401, 'authentication_required', 'Clerk did not issue a session token for commercial authorization.');
  }

  let response: Response;
  try {
    response = await fetch(`${commercialApiBase}/api/v1/commercial/session`, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
  } catch {
    return jsonError(503, 'commercial_session_sync_unavailable', 'The hosted commercial membership boundary could not be reached.');
  }
  if (response.ok) return undefined;
  if (response.status === 401 || response.status === 403) {
    return jsonError(403, 'commercial_access_denied', 'The signed-in principal is not authorized for the hosted commercial tenant.');
  }
  return jsonError(503, 'commercial_session_sync_unavailable', 'The hosted commercial membership boundary rejected the authorization check.');
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json(
    { code, message },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}
