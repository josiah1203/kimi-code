import { createHash } from 'node:crypto';

import {
  capabilityStatusSchema,
  nowIsoDateTime,
  type CapabilityStatus,
  type IdentityProvider,
  type OrganizationId,
  type User,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type CustomerManagedKeyAdapter,
  type DomainVerificationAdapter,
  type EnterpriseIdentityAdapter,
  type PrivateNetworkAdapter,
  type ScimAdapter,
} from '@spiderbyte/commercial-ports';

function available(capability: CapabilityStatus['capability'], adapter: string, reason: string): CapabilityStatus {
  return capabilityStatusSchema.parse({ capability, availability: 'available', adapter, reason, checked_at: nowIsoDateTime() });
}

function unavailable(capability: CapabilityStatus['capability'], adapter: string, reason: string): CapabilityStatus {
  return capabilityStatusSchema.parse({ capability, availability: 'not_configured', adapter, reason, checked_at: nowIsoDateTime() });
}

export class LocalTestEnterpriseIdentityAdapter implements EnterpriseIdentityAdapter {
  capability(): CapabilityStatus {
    return available('sso', 'local-test-sso', 'deterministic SAML/OIDC validation double; not an identity provider');
  }

  async validateProvider(input: { readonly provider: IdentityProvider }): Promise<{ readonly valid: boolean; readonly reason?: string }> {
    const valid = input.provider.type === 'oidc' ? input.provider.issuer !== undefined : input.provider.entity_id !== undefined;
    return valid ? { valid } : { valid, reason: 'provider configuration is missing its protocol identifier' };
  }
}

export class LocalTestScimAdapter implements ScimAdapter {
  private readonly users = new Map<string, User>();

  capability(): CapabilityStatus {
    return available('scim', 'local-test-scim', 'deterministic SCIM lifecycle double; not a provisioning service');
  }

  async provisionUser(input: { readonly organization_id: OrganizationId; readonly user: User }): Promise<{ readonly external_ref: string }> {
    const externalRef = `scim:${input.organization_id}:${input.user.id}`;
    this.users.set(externalRef, input.user);
    return { external_ref: externalRef };
  }

  async deprovisionUser(input: { readonly organization_id: OrganizationId; readonly external_ref: string }): Promise<void> {
    this.users.delete(input.external_ref);
  }

  async syncGroups(_input: { readonly organization_id: OrganizationId }): Promise<{ readonly group_count: number }> {
    return { group_count: 0 };
  }
}

export class LocalTestDomainVerificationAdapter implements DomainVerificationAdapter {
  private readonly challenges = new Map<string, string>();

  capability(): CapabilityStatus {
    return available('sso', 'local-test-domain-verification', 'deterministic domain verification double; not DNS infrastructure');
  }

  async issueChallenge(input: { readonly domain: string; readonly token: string }): Promise<{ readonly method: 'dns_txt'; readonly record: string }> {
    this.challenges.set(input.domain, hash(input.token));
    return { method: 'dns_txt', record: `spiderbyte-verification=${input.token}` };
  }

  async verify(input: { readonly domain: string; readonly token_hash: string }): Promise<boolean> {
    return this.challenges.get(input.domain) === input.token_hash;
  }
}

export class LocalTestCustomerManagedKeyAdapter implements CustomerManagedKeyAdapter {
  capability(): CapabilityStatus {
    return available('customer_managed_keys', 'local-test-kms', 'deterministic key validation double; not a KMS');
  }

  async validateKey(input: { readonly organization_id: OrganizationId; readonly key_ref: string }): Promise<{ readonly valid: boolean; readonly reason?: string }> {
    return input.key_ref.startsWith('kms_') ? { valid: true } : { valid: false, reason: 'test KMS references must start with kms_' };
  }
}

export class LocalTestPrivateNetworkAdapter implements PrivateNetworkAdapter {
  capability(): CapabilityStatus {
    return available('private_networking', 'local-test-network', 'deterministic private-network validation double; not network infrastructure');
  }

  async validateNetwork(input: { readonly organization_id: OrganizationId; readonly network_ref: string }): Promise<{ readonly valid: boolean; readonly reason?: string }> {
    return input.network_ref.startsWith('network_') ? { valid: true } : { valid: false, reason: 'test network references must start with network_' };
  }
}

export class UnavailableEnterpriseIdentityAdapter implements EnterpriseIdentityAdapter {
  capability(): CapabilityStatus { return unavailable('sso', 'unavailable-sso', 'SAML/OIDC provider is not configured'); }
  async validateProvider(_input: { readonly provider: IdentityProvider }): Promise<{ readonly valid: boolean; readonly reason?: string }> { throw new CapabilityUnavailableError(this.capability()); }
}

export class UnavailableScimAdapter implements ScimAdapter {
  capability(): CapabilityStatus { return unavailable('scim', 'unavailable-scim', 'SCIM provider is not configured'); }
  async provisionUser(_input: { readonly organization_id: OrganizationId; readonly user: User }): Promise<{ readonly external_ref: string }> { throw new CapabilityUnavailableError(this.capability()); }
  async deprovisionUser(_input: { readonly organization_id: OrganizationId; readonly external_ref: string }): Promise<void> { throw new CapabilityUnavailableError(this.capability()); }
  async syncGroups(_input: { readonly organization_id: OrganizationId }): Promise<{ readonly group_count: number }> { throw new CapabilityUnavailableError(this.capability()); }
}

export class UnavailableDomainVerificationAdapter implements DomainVerificationAdapter {
  capability(): CapabilityStatus { return unavailable('sso', 'unavailable-domain-verification', 'DNS/HTTP domain verification is not configured'); }
  async issueChallenge(_input: { readonly domain: string; readonly token: string }): Promise<{ readonly method: 'dns_txt'; readonly record: string }> { throw new CapabilityUnavailableError(this.capability()); }
  async verify(_input: { readonly domain: string; readonly token_hash: string }): Promise<boolean> { throw new CapabilityUnavailableError(this.capability()); }
}

export class UnavailableCustomerManagedKeyAdapter implements CustomerManagedKeyAdapter {
  capability(): CapabilityStatus { return unavailable('customer_managed_keys', 'unavailable-kms', 'customer-managed key provider is not configured'); }
  async validateKey(_input: { readonly organization_id: OrganizationId; readonly key_ref: string }): Promise<{ readonly valid: boolean; readonly reason?: string }> { throw new CapabilityUnavailableError(this.capability()); }
}

export class UnavailablePrivateNetworkAdapter implements PrivateNetworkAdapter {
  capability(): CapabilityStatus { return unavailable('private_networking', 'unavailable-network', 'private networking provider is not configured'); }
  async validateNetwork(_input: { readonly organization_id: OrganizationId; readonly network_ref: string }): Promise<{ readonly valid: boolean; readonly reason?: string }> { throw new CapabilityUnavailableError(this.capability()); }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
