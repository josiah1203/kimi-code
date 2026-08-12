import {
  capabilityStatusSchema,
  type CapabilityKey,
  type CapabilityStatus,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type CapabilityAdapter,
} from '@spiderbyte/commercial-ports';

export class UnavailableCapabilityAdapter implements CapabilityAdapter {
  readonly adapter_name: string;

  constructor(
    private readonly capability_key: CapabilityKey,
    private readonly availability: 'not_configured' | 'temporarily_unavailable' | 'not_implemented',
    private readonly reason: string,
    adapterName = 'unavailable-adapter',
  ) {
    this.adapter_name = adapterName;
  }

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: this.capability_key,
      availability: this.availability,
      adapter: this.adapter_name,
      reason: this.reason,
      checked_at: new Date().toISOString(),
    });
  }

  assertAvailable(): never {
    throw new CapabilityUnavailableError(this.capability());
  }
}
