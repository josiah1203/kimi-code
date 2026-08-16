import { auth } from '@clerk/nextjs/server';

import {
  commercialCapabilitiesResponseSchema,
  type CommercialCapabilitiesResponse,
} from '@spiderbyte/protocol';

export const runtime = 'nodejs';

const FALLBACK_CAPABILITIES: CommercialCapabilitiesResponse = {
  service: 'spiderbyte-commercial-hosted',
  environment: 'web',
  capabilities: [
    {
      capability: 'identity',
      availability: 'not_configured',
      adapter: 'clerk-identity-pending-runtime-wiring',
      reason: 'The commercial hosted identity boundary is not configured for this web deployment.',
    },
    {
      capability: 'billing',
      availability: 'not_configured',
      adapter: 'clerk-billing-presentation-only',
      reason: 'Billing presentation may be available in Clerk, but server-side reconciliation and enforcement are not configured.',
    },
    {
      capability: 'entitlements',
      availability: 'not_configured',
      adapter: 'commercial-billing-pending-runtime-wiring',
      reason: 'SpiderByte commercial entitlements are not available to the web boundary.',
    },
    {
      capability: 'platform_identity_binding',
      availability: 'not_configured',
      adapter: 'kap-server-hosted-organization-sync',
      reason: 'Hosted organization membership synchronization into kap-server is not configured.',
    },
    {
      capability: 'platform_project_workspace_binding',
      availability: 'not_configured',
      adapter: 'kap-server-hosted-project-workspace-binding',
      reason: 'Approved hosted project/workspace mappings are not configured.',
    },
    {
      capability: 'hosted_compute',
      availability: 'not_configured',
      adapter: 'modal-runtime-pending',
      reason: 'Hosted compute is not configured.',
    },
    {
      capability: 'hosted_artifacts',
      availability: 'not_configured',
      adapter: 'cloudflare-r2-pending',
      reason: 'Hosted artifact storage is not configured.',
    },
  ],
};

/**
 * Expose only the commercial capability diagnostic to the browser.
 *
 * This endpoint intentionally does not exchange a Clerk JWT for a commercial
 * bearer token. The hosted Worker capability route is diagnostic, not an
 * authorization gate; tenant requests still require the configured delegated
 * identity bridge, commercial membership synchronization, and downstream
 * authorization checks.
 */
export async function GET(): Promise<Response> {
  let session: Awaited<ReturnType<typeof auth>>;
  try {
    session = await auth();
  } catch {
    return Response.json({
      ...FALLBACK_CAPABILITIES,
      capabilities: FALLBACK_CAPABILITIES.capabilities.map((capability) => ({
        ...capability,
        reason: 'Clerk identity verification is not configured for this web deployment.',
      })),
    } satisfies CommercialCapabilitiesResponse, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
  if (!session.userId) {
    return Response.json({ code: 'authentication_required', message: 'Sign in before reading commercial capability status.' }, {
      status: 401,
      headers: { 'cache-control': 'no-store' },
    });
  }

  const base = process.env.SPIDERBYTE_COMMERCIAL_API_URL?.replace(/\/+$/, '');
  if (!base) return json(FALLBACK_CAPABILITIES, 503);

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/v1/commercial/capabilities`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
  } catch {
    return json({
      ...FALLBACK_CAPABILITIES,
      capabilities: FALLBACK_CAPABILITIES.capabilities.map((capability) => ({
        ...capability,
        availability: 'temporarily_unavailable' as const,
        reason: 'The commercial hosted diagnostic endpoint could not be reached.',
      })),
    }, 503);
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    return json({
      ...FALLBACK_CAPABILITIES,
      capabilities: FALLBACK_CAPABILITIES.capabilities.map((capability) => ({
        ...capability,
        availability: 'temporarily_unavailable' as const,
        reason: 'The commercial hosted diagnostic response was not valid JSON.',
      })),
    }, 502);
  }
  const parsed = commercialCapabilitiesResponseSchema.safeParse(payload);
  if (!parsed.success) {
    return json({
      ...FALLBACK_CAPABILITIES,
      capabilities: FALLBACK_CAPABILITIES.capabilities.map((capability) => ({
        ...capability,
        availability: 'temporarily_unavailable' as const,
        reason: 'The commercial hosted diagnostic response did not match the public capability contract.',
      })),
    }, 502);
  }
  return json(parsed.data, upstream.status);
}

function json(payload: CommercialCapabilitiesResponse, status: number): Response {
  return Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}
