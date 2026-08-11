export declare const AGENT_WIRE_PROTOCOL_VERSION = "1.4";
export interface WireMigrationRecord {
    readonly type: string;
    [key: string]: unknown;
}
export interface WireMigration {
    readonly sourceVersion: string;
    readonly targetVersion: string;
    migrateRecord(record: WireMigrationRecord): WireMigrationRecord;
}
export declare function isNewerWireVersion(readVersion: string): boolean;
export declare function resolveWireMigrations(readVersion: string): readonly WireMigration[];
export declare function migrateWireRecord(record: WireMigrationRecord, migrations: readonly WireMigration[]): WireMigrationRecord;
export declare function migrateWireRecords(records: readonly WireMigrationRecord[], readVersion: string | undefined): WireMigrationRecord[];
