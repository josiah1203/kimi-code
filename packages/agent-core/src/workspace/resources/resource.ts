/** Workspace-native data and ML resources. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  Resource,
  ResourceCreateInput,
  ResourceExecuteInput,
  ResourceExecution,
  ResourceType,
  ResourceUpdateInput,
} from '@spiderbyte/protocol';

export interface WorkspaceResourcesChangedEvent {
  readonly resource: Resource;
  readonly kind: 'created' | 'updated' | 'state_changed';
}

export interface IWorkspaceResourceService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceResourcesChangedEvent>;
  list(type?: ResourceType): Promise<readonly Resource[]>;
  get(id: string): Promise<Resource | undefined>;
  create(input: ResourceCreateInput): Promise<Resource>;
  update(id: string, input: ResourceUpdateInput): Promise<Resource | undefined>;
  execute(id: string, input: ResourceExecuteInput): Promise<ResourceExecution>;
  archive(id: string, input: ResourceUpdateInput): Promise<Resource | undefined>;
}

export const IWorkspaceResourceService: ServiceIdentifier<IWorkspaceResourceService> =
  createDecorator<IWorkspaceResourceService>('resourceService');
