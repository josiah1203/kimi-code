import type { OrganizationId, UserId } from '@spiderbyte/commercial-domain';

import type { CapabilityAdapter } from './platform';

export type HostedBillingPayer = 'user' | 'organization';

export type HostedBillingSubscriptionState =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'ended'
  | 'incomplete'
  | 'abandoned'
  | 'unknown';

/** Provider-neutral view of a hosted billing subscription. */
export interface HostedBillingSubscription {
  readonly provider: string;
  readonly external_id: string;
  readonly payer: HostedBillingPayer;
  readonly payer_id: string;
  readonly plan_id: string;
  readonly plan_slug: string;
  readonly plan_name: string;
  readonly state: HostedBillingSubscriptionState;
  readonly period_start?: string;
  readonly period_end?: string;
}

/** Provider-neutral plan data used by hosted pricing and entitlement surfaces. */
export interface HostedBillingPlan {
  readonly provider: string;
  readonly external_id: string;
  readonly slug: string;
  readonly name: string;
  readonly payer: HostedBillingPayer;
  readonly description?: string;
  readonly monthly_amount_minor?: number;
  readonly annual_amount_minor?: number;
  readonly currency?: string;
  readonly features: readonly string[];
}

/**
 * Read-only hosted billing boundary.
 *
 * Checkout and billing mutations remain owned by the provider UI/webhooks;
 * SpiderByte consumes this boundary to reconcile local entitlements.
 */
export interface HostedBillingPort extends CapabilityAdapter {
  getOrganizationSubscription(organizationId: OrganizationId): Promise<HostedBillingSubscription | undefined>;
  getUserSubscription(userId: UserId): Promise<HostedBillingSubscription | undefined>;
  listPlans(payer: HostedBillingPayer): Promise<readonly HostedBillingPlan[]>;
}
