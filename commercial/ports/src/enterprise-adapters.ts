import type {
  IdentityProvider,
  OrganizationId,
  User,
} from '@spiderbyte/commercial-domain';

import type { CapabilityAdapter } from './platform';

export interface EnterpriseIdentityAdapter extends CapabilityAdapter {
  validateProvider(input: {
    readonly provider: IdentityProvider;
  }): Promise<{ readonly valid: boolean; readonly reason?: string }>;
}

export interface ScimAdapter extends CapabilityAdapter {
  provisionUser(input: { readonly organization_id: OrganizationId; readonly user: User }): Promise<{ readonly external_ref: string }>;
  deprovisionUser(input: { readonly organization_id: OrganizationId; readonly external_ref: string }): Promise<void>;
  syncGroups(input: { readonly organization_id: OrganizationId }): Promise<{ readonly group_count: number }>;
}

export interface DomainVerificationAdapter extends CapabilityAdapter {
  issueChallenge(input: { readonly domain: string; readonly token: string }): Promise<{ readonly method: 'dns_txt' | 'dns_cname' | 'http'; readonly record: string }>;
  verify(input: { readonly domain: string; readonly token_hash: string }): Promise<boolean>;
}

export interface CustomerManagedKeyAdapter extends CapabilityAdapter {
  validateKey(input: { readonly organization_id: OrganizationId; readonly key_ref: string }): Promise<{ readonly valid: boolean; readonly reason?: string }>;
}

export interface PrivateNetworkAdapter extends CapabilityAdapter {
  validateNetwork(input: { readonly organization_id: OrganizationId; readonly network_ref: string }): Promise<{ readonly valid: boolean; readonly reason?: string }>;
}

export type EnterpriseCapabilityAdapter = EnterpriseIdentityAdapter | ScimAdapter | DomainVerificationAdapter | CustomerManagedKeyAdapter | PrivateNetworkAdapter;
