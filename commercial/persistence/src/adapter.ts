import {
  capabilityStatusSchema,
  nowIsoDateTime,
  type CapabilityStatus,
} from '@spiderbyte/commercial-domain';
import {
  CapabilityUnavailableError,
  type CommercialStore,
  type RelationalStore,
} from '@spiderbyte/commercial-ports';

import { COMMERCIAL_MIGRATIONS, SqlMigrationPort, type CommercialSqlClient } from './migrations';
import { SqlCommercialStore } from './sqlStore';

export interface CommercialDatabaseAdapter extends RelationalStore {}

/** Production hosted database adapter boundary. No database is claimed until configured. */
export class UnavailableCommercialDatabaseAdapter implements CommercialDatabaseAdapter {
  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'hosted_database',
      availability: 'not_configured',
      adapter: 'unavailable-commercial-database',
      reason: 'hosted commercial database credentials and migrations are not configured',
      checked_at: nowIsoDateTime(),
    });
  }

  async open(): Promise<CommercialStore> {
    throw new CapabilityUnavailableError(this.capability());
  }
}

export class SqlCommercialDatabaseAdapter implements CommercialDatabaseAdapter {
  private readonly clock: { now(): string };

  constructor(
    private readonly client: CommercialSqlClient | undefined,
    clock?: { now(): string },
  ) {
    this.clock = clock ?? { now: nowIsoDateTime };
  }

  capability(): CapabilityStatus {
    return capabilityStatusSchema.parse({
      capability: 'hosted_database',
      availability: this.client === undefined ? 'not_configured' : 'available',
      adapter: this.client === undefined ? 'sql-commercial-database-unavailable' : 'sql-commercial-database',
      reason: this.client === undefined
        ? 'a pooled commercial SQL client is not configured'
        : 'commercial SQL persistence client is configured; deployment must provide production operations',
      checked_at: this.clock.now(),
    });
  }

  async open(): Promise<CommercialStore> {
    if (this.client === undefined) throw new CapabilityUnavailableError(this.capability());
    const migrations = new SqlMigrationPort(this.client, this.clock);
    for (const migration of COMMERCIAL_MIGRATIONS) await migrations.apply(migration);
    return new SqlCommercialStore(this.client);
  }
}
