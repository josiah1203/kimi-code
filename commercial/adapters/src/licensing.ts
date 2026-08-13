import {
  capabilityStatusSchema,
  nowIsoDateTime,
  type CapabilityStatus,
  type OfflineLicense,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type CapabilityAdapter,
  type Clock,
  type LicenseAuthorityPort,
  type LicenseKeyResolver,
  type LicenseVerificationKey,
} from '@spiderbyte/commercial-ports';

export interface LocalLicenseKeyResolverOptions {
  readonly environment: 'development' | 'test';
  readonly keys: Readonly<Record<string, LicenseVerificationKey>>;
  readonly clock?: Clock;
}

/** Explicit local/test key material. It rejects production construction. */
export class LocalLicenseKeyResolver implements LicenseKeyResolver {
  readonly adapter_name = 'local-license-key-resolver';

  constructor(private readonly options: LocalLicenseKeyResolverOptions) {
    if (options.environment !== 'development' && options.environment !== 'test') {
      throw new Error('LocalLicenseKeyResolver is only valid in development or test mode');
    }
  }

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'licensing',
      availability: 'available',
      adapter: this.adapter_name,
      reason: `explicit ${this.options.environment} license verification keys`,
      checked_at: this.options.clock?.now() ?? nowIsoDateTime(),
    });
  }

  async resolveVerificationKey(keyId: string): Promise<LicenseVerificationKey | undefined> {
    return this.options.keys[keyId];
  }
}

export interface LocalLicenseAuthorityOptions {
  readonly environment: 'development' | 'test';
  readonly licenses: readonly OfflineLicense[];
  readonly clock?: Clock;
}

/** Deterministic authority double for local/test renewal flows. */
export class LocalLicenseAuthorityAdapter implements LicenseAuthorityPort {
  readonly adapter_name = 'local-license-authority';

  constructor(private readonly options: LocalLicenseAuthorityOptions) {
    if (options.environment !== 'development' && options.environment !== 'test') {
      throw new Error('LocalLicenseAuthorityAdapter is only valid in development or test mode');
    }
  }

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'licensing',
      availability: 'available',
      adapter: this.adapter_name,
      reason: `explicit ${this.options.environment} license renewal double`,
      checked_at: this.options.clock?.now() ?? nowIsoDateTime(),
    });
  }

  async renew(input: Parameters<LicenseAuthorityPort['renew']>[0]): Promise<OfflineLicense | undefined> {
    return this.options.licenses.find((license) =>
      license.organization_id === input.organization_id && license.id !== input.license_id,
    );
  }
}

export class UnavailableLicenseKeyResolver implements LicenseKeyResolver {
  readonly adapter_name = 'unavailable-license-key-resolver';

  constructor(
    private readonly availability: 'not_configured' | 'temporarily_unavailable' | 'not_implemented' = 'not_configured',
    private readonly reason = 'a production license verification key resolver is not configured',
  ) {}

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'licensing',
      availability: this.availability,
      adapter: this.adapter_name,
      reason: this.reason,
      checked_at: nowIsoDateTime(),
    });
  }

  async resolveVerificationKey(_keyId: string): Promise<LicenseVerificationKey | undefined> {
    throw new CapabilityUnavailableError(this.capability());
  }
}

export class UnavailableLicenseAuthorityAdapter implements LicenseAuthorityPort {
  readonly adapter_name = 'unavailable-license-authority';

  constructor(
    private readonly availability: 'not_configured' | 'temporarily_unavailable' | 'not_implemented' = 'not_configured',
    private readonly reason = 'an online license authority is not configured; offline activation remains supported',
  ) {}

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'licensing',
      availability: this.availability,
      adapter: this.adapter_name,
      reason: this.reason,
      checked_at: nowIsoDateTime(),
    });
  }

  async renew(_input: Parameters<LicenseAuthorityPort['renew']>[0]): Promise<OfflineLicense | undefined> {
    throw new CapabilityUnavailableError(this.capability());
  }
}

export type LicenseAdapter = LicenseKeyResolver | LicenseAuthorityPort | CapabilityAdapter;
