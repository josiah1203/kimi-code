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
