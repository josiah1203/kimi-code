import { describe, expect, it } from 'vitest';

import {
  COMMERCIAL_MIGRATIONS,
  InMemoryMigrationPort,
  SqlCommercialDatabaseAdapter,
  SqlMigrationPort,
  UnavailableCommercialDatabaseAdapter,
} from '@spiderbyte/commercial-persistence';
import type { CommercialSqlClient, CommercialSqlQueryResult } from '@spiderbyte/commercial-persistence';
import { accountSchema } from '@spiderbyte/commercial-domain';

const now = '2026-08-11T12:00:00.000Z';
const actor = { kind: 'system' as const, id: 'persistence-test' };

const asRow = <Row extends Record<string, unknown>>(row: Record<string, unknown>): Row => row as Row;

class TestSqlClient implements CommercialSqlClient {
  private readonly records = new Map<string, Record<string, unknown>>();
  private readonly applied = new Map<number, { readonly id: string; readonly checksum: string; readonly applied_at: string }>();

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: readonly unknown[] = [],
  ): Promise<CommercialSqlQueryResult<Row>> {
    if (sql.includes('CREATE TABLE IF NOT EXISTS commercial_schema_migrations')) return { rows: [] as Row[] };
    if (sql.includes('CREATE TABLE commercial_records') || sql.includes('CREATE TABLE commercial_ledger_entries') || sql.includes('CREATE TABLE commercial_idempotency')) return { rows: [] as Row[] };
    if (sql.includes('DROP TABLE IF EXISTS') || sql.includes('CREATE TABLE commercial_audit_events')) return { rows: [] as Row[] };
    if (sql.includes('SELECT version FROM commercial_schema_migrations ORDER BY version ASC')) {
      return { rows: [...this.applied.keys()].toSorted((left, right) => left - right).map((version) => asRow<Row>({ version })) };
    }
    if (sql.includes('SELECT version FROM commercial_schema_migrations ORDER BY version DESC')) {
      const version = [...this.applied.keys()].toSorted((left, right) => right - left)[0];
      return { rows: version === undefined ? [] : [asRow<Row>({ version })] };
    }
    if (sql.includes('SELECT checksum FROM commercial_schema_migrations')) {
      const item = this.applied.get(Number(parameters[0]));
      return { rows: item === undefined ? [] : [asRow<Row>({ checksum: item.checksum })] };
    }
    if (sql.includes('SELECT version, checksum FROM commercial_schema_migrations')) {
      const item = this.applied.get(Number(parameters[0]));
      return { rows: item === undefined ? [] : [asRow<Row>({ version: Number(parameters[0]), checksum: item.checksum })] };
    }
    if (sql.includes('INSERT INTO commercial_schema_migrations')) {
      this.applied.set(Number(parameters[0]), { id: String(parameters[1]), checksum: String(parameters[2]), applied_at: String(parameters[3]) });
      return { rows: [] as Row[] };
    }
    if (sql.includes('DELETE FROM commercial_schema_migrations')) {
      this.applied.delete(Number(parameters[0]));
      return { rows: [] as Row[] };
    }
    if (sql.includes('SELECT payload FROM commercial_records WHERE collection = $1 AND record_id = $2')) {
      const record = this.records.get(`${String(parameters[0])}:${String(parameters[1])}`);
      return { rows: record === undefined ? [] : [asRow<Row>({ payload: record })] };
    }
    if (sql.includes('SELECT payload FROM commercial_records WHERE collection = $1 ORDER BY record_id ASC')) {
      const prefix = `${String(parameters[0])}:`;
      return { rows: [...this.records.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([, record]) => asRow<Row>({ payload: record })) };
    }
    if (sql.includes('INSERT INTO commercial_records')) {
      this.records.set(`${String(parameters[0])}:${String(parameters[1])}`, JSON.parse(String(parameters[6])) as Record<string, unknown>);
      return { rows: [] as Row[] };
    }
    if (sql.includes('DELETE FROM commercial_records')) {
      this.records.delete(`${String(parameters[0])}:${String(parameters[1])}`);
      return { rows: [] as Row[] };
    }
    throw new Error(`unexpected test SQL: ${sql}`);
  }

  async transaction<T>(operation: (client: CommercialSqlClient) => Promise<T>): Promise<T> {
    const records = new Map([...this.records.entries()].map(([key, value]) => [key, structuredClone(value)]));
    const applied = new Map(this.applied);
    try {
      return await operation(this);
    } catch (error) {
      this.records.clear();
      for (const [key, value] of records) this.records.set(key, value);
      this.applied.clear();
      for (const [version, value] of applied) this.applied.set(version, value);
      throw error;
    }
  }
}

describe('commercial persistence boundary', () => {
  it('has ordered, checksummed, reversible migrations', async () => {
    const port = new InMemoryMigrationPort();
    for (const migration of COMMERCIAL_MIGRATIONS) await port.apply(migration);
    expect(await port.listApplied()).toEqual([1, 2, 3]);
    for (const migration of [...COMMERCIAL_MIGRATIONS].toReversed()) await port.rollback(migration);
    expect(await port.listApplied()).toEqual([]);
    expect(new Set(COMMERCIAL_MIGRATIONS.map((migration) => migration.checksum)).size).toBe(COMMERCIAL_MIGRATIONS.length);
  });

  it('fails closed without a hosted database adapter', async () => {
    const adapter = new UnavailableCommercialDatabaseAdapter();
    expect(adapter.capability().availability).toBe('not_configured');
    await expect(adapter.open()).rejects.toMatchObject({ code: 'commercial.hosted_database.not_configured' });
  });

  it('opens a migration-backed SQL store and rolls back a failed transaction', async () => {
    const client = new TestSqlClient();
    const adapter = new SqlCommercialDatabaseAdapter(client, { now: () => now });
    expect(adapter.capability().availability).toBe('available');
    const store = await adapter.open();
    const account = accountSchema.parse({
      id: 'acct_sql', state: 'active', display_name: 'SQL Account', primary_user_id: 'usr_sql',
      version: 1, created_at: now, updated_at: now, created_by: actor, updated_by: actor,
    });
    await store.put('accounts', account.id, account);
    expect(await store.get('accounts', account.id)).toEqual(account);
    await expect(store.transaction(async (transaction) => {
      await transaction.put('accounts', 'acct_rollback', { ...account, id: 'acct_rollback' });
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(await store.get('accounts', 'acct_rollback')).toBeUndefined();
    expect(await new SqlMigrationPort(client, { now: () => now }).listApplied()).toEqual([1, 2, 3]);
    await expect(store.put('accounts', 'acct_mismatch', { ...account, id: 'acct_other' })).rejects.toThrow('does not match store key');
  });
});
