import { createHash } from 'node:crypto';

import type { MigrationDefinition, MigrationPort } from '@spiderbyte/commercial-ports';

const migrationSource = [
  {
    id: 'commercial-001-foundations',
    version: 1,
    up: `
CREATE TABLE commercial_records (
  collection TEXT NOT NULL,
  record_id TEXT NOT NULL,
  organization_id TEXT,
  account_id TEXT,
  state TEXT,
  version INTEGER NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (collection, record_id)
);
CREATE INDEX commercial_records_tenant_idx ON commercial_records (account_id, organization_id, collection);
`,
    down: 'DROP TABLE IF EXISTS commercial_records;',
  },
  {
    id: 'commercial-002-ledger',
    version: 2,
    up: `
CREATE TABLE commercial_ledger_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  usage_event_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE UNIQUE INDEX commercial_ledger_event_id_idx ON commercial_ledger_entries (id);
`,
    down: 'DROP TABLE IF EXISTS commercial_ledger_entries;',
  },
  {
    id: 'commercial-003-hosted-surfaces',
    version: 3,
    up: `
CREATE TABLE commercial_idempotency (
  scope TEXT NOT NULL,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, request_id)
);
CREATE TABLE commercial_audit_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  organization_id TEXT,
  sequence BIGINT NOT NULL,
  previous_hash CHAR(64),
  integrity_hash CHAR(64) NOT NULL,
  payload JSONB NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);
`,
    down: 'DROP TABLE IF EXISTS commercial_audit_events; DROP TABLE IF EXISTS commercial_idempotency;',
  },
] as const;

export interface CommercialSqlQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[];
  readonly rowCount?: number;
}

/**
 * Minimal PostgreSQL-compatible client boundary. A production adapter supplies
 * the driver, pooling, TLS, failover, and transaction implementation; this
 * package never owns credentials or a database connection.
 */
export interface CommercialSqlClient {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: readonly unknown[],
  ): Promise<CommercialSqlQueryResult<Row>>;
  transaction<T>(operation: (client: CommercialSqlClient) => Promise<T>): Promise<T>;
}

export const COMMERCIAL_MIGRATIONS: readonly MigrationDefinition[] = migrationSource.map((migration) => ({
  ...migration,
  checksum: createHash('sha256').update(`${migration.up}\n---DOWN---\n${migration.down}`).digest('hex'),
}));

export class InMemoryMigrationPort implements MigrationPort {
  private readonly applied = new Map<number, string>();

  async listApplied(): Promise<readonly number[]> {
    return [...this.applied.keys()].toSorted((left, right) => left - right);
  }

  async apply(migration: MigrationDefinition): Promise<void> {
    const existing = this.applied.get(migration.version);
    if (existing !== undefined && existing !== migration.checksum) throw new Error(`migration checksum changed for version ${migration.version}`);
    this.applied.set(migration.version, migration.checksum);
  }

  async rollback(migration: MigrationDefinition): Promise<void> {
    if (this.applied.get(migration.version) !== migration.checksum) throw new Error(`migration ${migration.version} is not applied with the expected checksum`);
    this.applied.delete(migration.version);
  }
}

export class SqlMigrationPort implements MigrationPort {
  constructor(
    private readonly client: CommercialSqlClient,
    private readonly clock: { now(): string },
  ) {}

  async listApplied(): Promise<readonly number[]> {
    await this.ensureTable();
    const result = await this.client.query<{ version: number }>(
      'SELECT version FROM commercial_schema_migrations ORDER BY version ASC',
    );
    return result.rows.map((row) => row.version);
  }

  async apply(migration: MigrationDefinition): Promise<void> {
    await this.ensureTable();
    const existing = await this.client.query<{ checksum: string }>(
      'SELECT checksum FROM commercial_schema_migrations WHERE version = $1',
      [migration.version],
    );
    if (existing.rows[0] !== undefined) {
      if (existing.rows[0].checksum !== migration.checksum) {
        throw new Error(`migration checksum changed for version ${migration.version}`);
      }
      return;
    }
    await this.client.transaction(async (transaction) => {
      await transaction.query(migration.up);
      await transaction.query(
        'INSERT INTO commercial_schema_migrations (version, migration_id, checksum, applied_at) VALUES ($1, $2, $3, $4)',
        [migration.version, migration.id, migration.checksum, this.clock.now()],
      );
    });
  }

  async rollback(migration: MigrationDefinition): Promise<void> {
    await this.ensureTable();
    const applied = await this.client.query<{ version: number; checksum: string }>(
      'SELECT version, checksum FROM commercial_schema_migrations WHERE version = $1',
      [migration.version],
    );
    const record = applied.rows[0];
    if (record === undefined || record.checksum !== migration.checksum) {
      throw new Error(`migration ${migration.version} is not applied with the expected checksum`);
    }
    const latest = await this.client.query<{ version: number }>(
      'SELECT version FROM commercial_schema_migrations ORDER BY version DESC LIMIT 1',
    );
    if (Number(latest.rows[0]?.version) !== migration.version) {
      throw new Error(`migration ${migration.version} must be rolled back in reverse order`);
    }
    await this.client.transaction(async (transaction) => {
      await transaction.query(migration.down);
      await transaction.query('DELETE FROM commercial_schema_migrations WHERE version = $1', [migration.version]);
    });
  }

  private async ensureTable(): Promise<void> {
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS commercial_schema_migrations (
        version INTEGER PRIMARY KEY,
        migration_id TEXT NOT NULL,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL
      );
    `);
  }
}
