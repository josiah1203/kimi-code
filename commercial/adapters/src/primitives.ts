import { createHash, randomBytes } from 'node:crypto';

import type {
  AuditEvent,
  CapabilityAvailability,
  CapabilityKey,
  CapabilityStatus,
} from '@spiderbyte/commercial-domain';
import {
  assertSafeMetadata,
  auditEventSchema,
  capabilityStatusSchema,
  nowIsoDateTime,
} from '@spiderbyte/commercial-domain';
import type {
  AuditWriteInput,
  AuditReader,
  AuditWriter,
  CapabilityRegistry,
  Clock,
  IdGenerator,
  TokenGenerator,
} from '@spiderbyte/commercial-ports';

export class SystemClock implements Clock {
  now(): string {
    return nowIsoDateTime();
  }
}

export class MonotonicIdGenerator implements IdGenerator {
  private sequence = 0;

  next(prefix: string): string {
    this.sequence += 1;
    return `${prefix}${this.sequence.toString(36).padStart(4, '0')}`;
  }
}

export class SecureTokenGenerator implements TokenGenerator {
  token(bytes: number): string {
    if (!Number.isInteger(bytes) || bytes < 16 || bytes > 256) {
      throw new RangeError('token size must be between 16 and 256 bytes');
    }
    return randomBytes(bytes).toString('base64url');
  }
}

export class DeterministicTokenGenerator implements TokenGenerator {
  private sequence = 0;

  token(bytes: number): string {
    if (!Number.isInteger(bytes) || bytes < 16 || bytes > 256) {
      throw new RangeError('token size must be between 16 and 256 bytes');
    }
    this.sequence += 1;
    return `test-token-${this.sequence.toString(36)}-${'x'.repeat(Math.max(8, bytes))}`;
  }
}

export class StaticCapabilityRegistry implements CapabilityRegistry {
  private readonly statuses: Map<CapabilityKey, CapabilityStatus>;

  constructor(
    statuses: Partial<Record<CapabilityKey, CapabilityStatus>> = {},
    clock: Clock = new SystemClock(),
  ) {
    const keys: readonly CapabilityKey[] = [
      'identity',
      'hosted_database',
      'payment',
      'hosted_compute',
      'hosted_artifacts',
      'managed_llm',
      'event_bus',
      'workflow_engine',
      'secrets',
      'observability',
      'sso',
      'scim',
      'webhooks',
      'customer_managed_keys',
      'private_networking',
      'licensing',
    ];
    this.statuses = new Map(keys.map((capability) => [
      capability,
      statuses[capability] ?? capabilityStatusSchema.parse({
        capability,
        availability: 'not_configured' satisfies CapabilityAvailability,
        reason: `no adapter is configured for ${capability}`,
        checked_at: clock.now(),
      }),
    ]));
  }

  status(capability: CapabilityKey): CapabilityStatus {
    const value = this.statuses.get(capability);
    if (value === undefined) {
      return capabilityStatusSchema.parse({
        capability,
        availability: 'not_implemented',
        reason: `capability is not registered: ${capability}`,
        checked_at: nowIsoDateTime(),
      });
    }
    return value;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

async function sha256(value: string): Promise<string> {
  return createHash('sha256').update(value).digest('hex');
}

export class InMemoryAuditWriter implements AuditWriter, AuditReader {
  private readonly events: AuditEvent[] = [];

  async append(input: AuditWriteInput): Promise<void> {
    assertSafeMetadata(input.detail);
    const previous = this.events.at(-1);
    const sequence = this.events.length + 1;
    const material = {
      ...input,
      sequence,
      previous_hash: previous?.integrity_hash,
    };
    const integrity_hash = await sha256(canonicalJson(material));
    this.events.push(auditEventSchema.parse({
      ...input,
      id: `audit_${sequence.toString(36).padStart(8, '0')}`,
      sequence,
      previous_hash: previous?.integrity_hash,
      integrity_hash,
    }));
  }

  list(): readonly AuditEvent[] {
    return structuredClone(this.events);
  }

  async read(input: { readonly account_id: string; readonly organization_id?: string; readonly workspace_id?: string }): Promise<readonly AuditEvent[]> {
    return structuredClone(this.events.filter((event) =>
      event.account_id === input.account_id &&
      (input.organization_id === undefined || event.organization_id === input.organization_id) &&
      (input.workspace_id === undefined || event.workspace_id === input.workspace_id),
    ));
  }

  async verifyIntegrity(): Promise<boolean> {
    let previousHash: string | undefined;
    for (const [index, event] of this.events.entries()) {
      if (event.sequence !== index + 1 || event.previous_hash !== previousHash) return false;
      const { id: _id, integrity_hash: _hash, ...rest } = event;
      const expected = await sha256(canonicalJson(rest));
      if (expected !== event.integrity_hash) return false;
      previousHash = event.integrity_hash;
    }
    return true;
  }
}
