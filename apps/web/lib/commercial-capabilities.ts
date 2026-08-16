'use client';

import {
  commercialCapabilitiesResponseSchema,
  type CommercialCapabilitiesResponse,
} from '@spiderbyte/protocol';

const LOCAL_FALLBACK: CommercialCapabilitiesResponse = {
  service: 'spiderbyte-commercial-hosted',
  environment: 'web',
  capabilities: [
    {
      capability: 'billing',
      availability: 'not_configured',
      adapter: 'commercial-status-unavailable',
      reason: 'Commercial capability status is unavailable from the web boundary.',
    },
    {
      capability: 'entitlements',
      availability: 'not_configured',
      adapter: 'commercial-status-unavailable',
      reason: 'Commercial entitlement status is unavailable from the web boundary.',
    },
    {
      capability: 'platform_identity_binding',
      availability: 'not_configured',
      adapter: 'commercial-status-unavailable',
      reason: 'Hosted organization membership is not currently bound to the kap-server platform directory.',
    },
    {
      capability: 'platform_project_workspace_binding',
      availability: 'not_configured',
      adapter: 'commercial-status-unavailable',
      reason: 'No approved hosted project/workspace mappings are configured for the kap-server platform directory.',
    },
  ],
};

export async function fetchCommercialCapabilities(): Promise<CommercialCapabilitiesResponse> {
  try {
    const response = await fetch('/api/commercial/capabilities', { cache: 'no-store' });
    const parsed = commercialCapabilitiesResponseSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : LOCAL_FALLBACK;
  } catch {
    return LOCAL_FALLBACK;
  }
}
