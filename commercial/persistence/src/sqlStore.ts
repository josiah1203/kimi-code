import type {
  CommercialCollection,
  CommercialCollectionTypes,
  CommercialStore,
} from '@spiderbyte/commercial-ports';

import type { CommercialSqlClient } from './migrations';

interface CommercialRecordRow extends Record<string, unknown> {
  payload: unknown;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function payloadFromRow(row: CommercialRecordRow): unknown {
  return typeof row.payload === 'string' ? JSON.parse(row.payload) as unknown : row.payload;
}

/**
 * Generic JSONB-backed commercial store. The SQL client is injected so a
 * hosted deployment can provide its pooled PostgreSQL driver, TLS, retries,
 * and failover policy without putting infrastructure credentials in the
 * commercial domain or application packages.
 */
export class SqlCommercialStore implements CommercialStore {
  constructor(private readonly client: CommercialSqlClient) {}

  async get<K extends CommercialCollection>(
    collection: K,
    id: string,
  ): Promise<CommercialCollectionTypes[K] | undefined> {
    const result = await this.client.query<CommercialRecordRow>(
      'SELECT payload FROM commercial_records WHERE collection = $1 AND record_id = $2',
      [collection, id],
    );
    const row = result.rows[0];
    return row === undefined ? undefined : clone(payloadFromRow(row) as CommercialCollectionTypes[K]);
  }

  async list<K extends CommercialCollection>(collection: K): Promise<readonly CommercialCollectionTypes[K][]> {
    const result = await this.client.query<CommercialRecordRow>(
      'SELECT payload FROM commercial_records WHERE collection = $1 ORDER BY record_id ASC',
      [collection],
    );
    return result.rows.map((row) => clone(payloadFromRow(row) as CommercialCollectionTypes[K]));
  }

  async put<K extends CommercialCollection>(
    collection: K,
    id: string,
    value: CommercialCollectionTypes[K],
  ): Promise<void> {
    const record = asRecord(value);
    if (record['id'] !== undefined && record['id'] !== id) {
      throw new Error(`commercial record id does not match store key for ${collection}`);
    }
    await this.client.query(
      `
        INSERT INTO commercial_records
          (collection, record_id, organization_id, account_id, state, version, payload, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::timestamptz, $9::timestamptz)
        ON CONFLICT (collection, record_id) DO UPDATE SET
          organization_id = EXCLUDED.organization_id,
          account_id = EXCLUDED.account_id,
          state = EXCLUDED.state,
          version = EXCLUDED.version,
          payload = EXCLUDED.payload,
          updated_at = EXCLUDED.updated_at
      `,
      [
        collection,
        id,
        stringValue(record['organization_id']),
        stringValue(record['account_id']),
        stringValue(record['state']),
        numberValue(record['version']),
        JSON.stringify(value),
        stringValue(record['created_at']),
        stringValue(record['updated_at']),
      ],
    );
  }

  async delete(collection: CommercialCollection, id: string): Promise<void> {
    await this.client.query(
      'DELETE FROM commercial_records WHERE collection = $1 AND record_id = $2',
      [collection, id],
    );
  }

  async lock(key: string): Promise<void> {
    await this.client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
  }

  async transaction<T>(operation: (store: CommercialStore) => Promise<T>): Promise<T> {
    return this.client.transaction((transaction) => operation(new SqlCommercialStore(transaction)));
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}
