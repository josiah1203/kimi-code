import { createHash } from 'node:crypto';

import {
  assertSafeMetadata,
  auditEventSchema,
} from '@spiderbyte/commercial-domain';
import type { AuditWriteInput, AuditWriter } from '@spiderbyte/commercial-ports';

import type { CommercialSqlClient } from './migrations';

/**
 * PostgreSQL-backed audit append boundary. The advisory lock serializes the
 * global hash chain across Worker isolates; the caller still owns the
 * application-level authorization and transaction policy.
 */
export class SqlAuditWriter implements AuditWriter {
  constructor(private readonly client: CommercialSqlClient) {}

  async append(input: AuditWriteInput): Promise<void> {
    assertSafeMetadata(input.detail);
    await this.client.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['commercial:audit-chain']);
      const latest = await transaction.query<{ sequence: number | string; integrity_hash: string }>(
        'SELECT sequence, integrity_hash FROM commercial_audit_events ORDER BY sequence DESC LIMIT 1',
      );
      const previous = latest.rows[0];
      const sequence = Number(previous?.sequence ?? 0) + 1;
      const previousHash = previous?.integrity_hash;
      const material = {
        ...input,
        sequence,
        previous_hash: previousHash,
      };
      const integrityHash = createHash('sha256').update(canonicalJson(material)).digest('hex');
      const event = auditEventSchema.parse({
        ...input,
        id: `audit_${sequence.toString(36).padStart(8, '0')}`,
        sequence,
        previous_hash: previousHash,
        integrity_hash: integrityHash,
      });
      await transaction.query(
        `
          INSERT INTO commercial_audit_events
            (id, account_id, organization_id, sequence, previous_hash, integrity_hash, payload, occurred_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz)
        `,
        [
          event.id,
          event.account_id,
          event.organization_id ?? null,
          event.sequence,
          event.previous_hash ?? null,
          event.integrity_hash,
          JSON.stringify(event),
          event.occurred_at,
        ],
      );
    });
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
