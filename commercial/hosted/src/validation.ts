import {
  assertSafeMetadata,
  isoDateTimeSchema,
  organizationIdSchema,
  workspaceIdSchema,
  type OrganizationId,
  type WorkspaceId,
} from '@spiderbyte/commercial-domain';
import type { EventEnvelope } from '@spiderbyte/commercial-ports';

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function parseEventEnvelope(value: unknown): EventEnvelope {
  const record = asRecord(value);
  if (record === undefined || !isNonEmptyString(record['event_id']) || !isNonEmptyString(record['type'])) {
    throw new Error('event message is malformed');
  }
  const organization = organizationIdSchema.parse(record['organization_id']);
  const workspaceValue = record['workspace_id'];
  const workspace = workspaceValue === undefined ? undefined : workspaceIdSchema.parse(workspaceValue);
  const occurredAt = isoDateTimeSchema.parse(record['occurred_at']);
  const payload = asRecord(record['payload']);
  if (payload === undefined) throw new Error('event payload must be an object');
  assertSafeMetadata(payload);
  const accountValue = record['account_id'];
  if (accountValue !== undefined && !isNonEmptyString(accountValue)) throw new Error('event account_id is malformed');
  const sequenceValue = record['sequence'];
  if (sequenceValue !== undefined && (!Number.isSafeInteger(sequenceValue) || Number(sequenceValue) < 1)) {
    throw new Error('event sequence is malformed');
  }
  return {
    event_id: record['event_id'],
    account_id: accountValue as EventEnvelope['account_id'],
    organization_id: organization,
    workspace_id: workspace,
    type: record['type'],
    sequence: sequenceValue as number | undefined,
    occurred_at: occurredAt,
    payload,
  };
}

export function organizationKey(event: EventEnvelope): string {
  const runId = event.payload['run_id'];
  if (typeof runId === 'string' && runId.length > 0) return `run:${event.organization_id}:${runId}`;
  const workspace = event.workspace_id ?? 'organization';
  return `scope:${event.organization_id}:${workspace}`;
}

export function eventScope(event: EventEnvelope): { readonly organization_id: OrganizationId; readonly workspace_id?: WorkspaceId } {
  return { organization_id: event.organization_id, workspace_id: event.workspace_id };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}
