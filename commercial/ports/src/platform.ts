import type {
  ActorRef,
  AuditEvent,
  CapabilityKey,
  CapabilityStatus,
  CommercialAction,
  OrganizationId,
  Principal,
  WorkspaceId,
} from '@spiderbyte/commercial-domain';

export interface Clock {
  now(): string;
}

export interface IdGenerator {
  next(prefix: string): string;
}

export interface TokenGenerator {
  token(bytes: number): string;
}

export interface CapabilityRegistry {
  status(capability: CapabilityKey): CapabilityStatus;
}

export interface AuthorizationContext {
  readonly principal: Principal;
  readonly organization_id?: OrganizationId;
  readonly workspace_id?: WorkspaceId;
  readonly action: CommercialAction;
}

export interface AuditWriter {
  append(input: AuditWriteInput): Promise<void>;
}

export interface AuditReader {
  read(input: { readonly account_id: string; readonly organization_id?: string; readonly workspace_id?: string }): Promise<readonly AuditEvent[]>;
}

export interface AuditWriteInput {
  readonly account_id: string;
  readonly organization_id?: string;
  readonly workspace_id?: string;
  readonly actor: ActorRef;
  readonly action: string;
  readonly target_type: string;
  readonly target_id: string;
  readonly outcome: 'allowed' | 'denied' | 'succeeded' | 'failed';
  readonly request_id: string;
  readonly occurred_at: string;
  readonly detail?: Record<string, unknown>;
}

export interface MigrationDefinition {
  readonly id: string;
  readonly version: number;
  readonly checksum: string;
  readonly up: string;
  readonly down: string;
}

export interface MigrationPort {
  listApplied(): Promise<readonly number[]>;
  apply(migration: MigrationDefinition): Promise<void>;
  rollback(migration: MigrationDefinition): Promise<void>;
}

export interface CapabilityAdapter {
  capability(): CapabilityStatus;
}

export function isCapabilityAvailable(status: CapabilityStatus): boolean {
  return status.availability === 'available';
}
