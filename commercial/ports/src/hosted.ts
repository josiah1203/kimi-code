import type {
  AccountId,
  CapabilityStatus,
  OrganizationId,
  WorkspaceId,
} from '@spiderbyte/commercial-domain';

import type { CapabilityAdapter } from './platform';
import type { CommercialStore } from './store';

/** The authoritative relational boundary used by hosted deployments. */
export interface RelationalStore extends CapabilityAdapter {
  open(): Promise<CommercialStore>;
}

export interface EventEnvelope {
  readonly event_id: string;
  readonly account_id?: AccountId;
  readonly organization_id: OrganizationId;
  readonly workspace_id?: WorkspaceId;
  readonly type: string;
  readonly sequence?: number;
  readonly occurred_at: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface EventBus extends CapabilityAdapter {
  publish(event: EventEnvelope): Promise<{ readonly event_id: string }>;
}

/** Durable event history. A live connection coordinator must not be the only history. */
export interface EventHistoryStore extends CapabilityAdapter {
  append(event: EventEnvelope): Promise<EventEnvelope & { readonly sequence: number }>;
  replay(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id?: WorkspaceId;
    readonly after_sequence?: number;
    readonly limit?: number;
  }): Promise<readonly (EventEnvelope & { readonly sequence: number })[]>;
}

export interface WorkflowRun {
  readonly id: string;
  readonly workflow_name: string;
  readonly state: string;
}

export interface WorkflowEngine extends CapabilityAdapter {
  start(input: {
    readonly workflow_name: string;
    readonly id: string;
    readonly payload: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowRun>;
  inspect(workflowName: string, id: string): Promise<WorkflowRun>;
  terminate(workflowName: string, id: string): Promise<void>;
}

/** Secret material is intentionally returned only at the adapter boundary. */
export interface SecretsProvider extends CapabilityAdapter {
  resolve(input: {
    readonly organization_id: OrganizationId;
    readonly secret_ref: string;
    readonly purpose: string;
  }): Promise<{ readonly value: string; readonly expires_at?: string }>;
}

export interface ArtifactObject {
  readonly object_ref: string;
  readonly content_address: string;
  readonly media_type?: string;
  readonly size_bytes: number;
  readonly metadata: Readonly<Record<string, string>>;
  readonly body: ReadableStream<Uint8Array>;
}

export interface ArtifactStore extends CapabilityAdapter {
  putObject(input: {
    readonly account_id: AccountId;
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly object_id: string;
    readonly content_address: string;
    readonly media_type?: string;
    readonly metadata?: Readonly<Record<string, string>>;
    readonly bytes: Uint8Array;
  }): Promise<{ readonly object_ref: string; readonly size_bytes: number }>;
  getObject(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly object_ref: string;
  }): Promise<ArtifactObject | undefined>;
  deleteObject(input: {
    readonly organization_id: OrganizationId;
    readonly workspace_id: WorkspaceId;
    readonly object_ref: string;
  }): Promise<void>;
}

export interface ObservabilityProvider extends CapabilityAdapter {
  record(input: {
    readonly level: 'debug' | 'info' | 'warn' | 'error';
    readonly event: string;
    readonly request_id?: string;
    readonly organization_id?: OrganizationId;
    readonly attributes?: Readonly<Record<string, string | number | boolean>>;
  }): Promise<void>;
}

export type HostedInfrastructureCapability = CapabilityStatus['capability'];
