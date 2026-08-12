import type { CapabilityStatus, WebhookEndpoint } from '@spiderbyte/commercial-domain';

export interface WebhookDeliveryAdapter {
  capability(): CapabilityStatus;
  deliver(input: {
    readonly endpoint: WebhookEndpoint;
    readonly event_id: string;
    readonly payload: string;
    readonly attempt: number;
    readonly idempotency_key: string;
  }): Promise<{ readonly delivered: boolean; readonly response_code?: number; readonly retry_after_ms?: number }>;
}

export class UnavailableWebhookDeliveryAdapter implements WebhookDeliveryAdapter {
  capability(): CapabilityStatus {
    return {
      capability: 'webhooks',
      availability: 'not_configured',
      adapter: 'unavailable-webhooks',
      reason: 'production webhook delivery and secret resolution are not configured',
      checked_at: new Date().toISOString(),
    };
  }

  async deliver(_input: Parameters<WebhookDeliveryAdapter['deliver']>[0]): Promise<{ readonly delivered: boolean }> {
    return { delivered: false };
  }
}
