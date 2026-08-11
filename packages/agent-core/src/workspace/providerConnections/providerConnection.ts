/**
 * Workspace-scoped provider connections.
 *
 * A connection is the public, durable projection of provider configuration.
 * Secret material is intentionally not part of this contract; callers pass a
 * `secret_*` reference owned by the host's secure store.
 */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  ProviderConnection,
  ProviderConnectionCommandInput,
  ProviderConnectionCreateInput,
  ProviderConnectionUpdateInput,
  ProviderModelDiscovery,
} from '@spiderbyte/protocol';

export interface WorkspaceProviderConnectionsChangedEvent {
  readonly connection: ProviderConnection;
  readonly kind: 'created' | 'updated' | 'validated' | 'activated' | 'revoked';
}

export interface IWorkspaceProviderConnectionService {
  readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceProviderConnectionsChangedEvent>;
  list(): Promise<readonly ProviderConnection[]>;
  get(id: string): Promise<ProviderConnection | undefined>;
  create(input: ProviderConnectionCreateInput): Promise<ProviderConnection>;
  update(id: string, input: ProviderConnectionUpdateInput): Promise<ProviderConnection | undefined>;
  validate(id: string, input: ProviderConnectionCommandInput): Promise<ProviderConnection | undefined>;
  activate(id: string, input: ProviderConnectionCommandInput): Promise<ProviderConnection | undefined>;
  revoke(id: string, input: ProviderConnectionCommandInput): Promise<ProviderConnection | undefined>;
  discoverModels(id: string): Promise<ProviderModelDiscovery | undefined>;
}

export const IWorkspaceProviderConnectionService: ServiceIdentifier<IWorkspaceProviderConnectionService> =
  createDecorator<IWorkspaceProviderConnectionService>('providerConnectionService');
