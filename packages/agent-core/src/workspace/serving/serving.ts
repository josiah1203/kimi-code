/** Workspace-scoped model packaging and serving endpoint contracts. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  ModelPackage,
  ModelPackageCreateInput,
  ServingEndpoint,
  ServingEndpointActionInput,
  ServingEndpointCreateInput,
} from '@spiderbyte/protocol';

export interface WorkspaceServingChangedEvent {
  readonly kind: 'package_created' | 'package_updated' | 'endpoint_updated';
  readonly package?: ModelPackage;
  readonly endpoint?: ServingEndpoint;
}

export interface IWorkspaceServingService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceServingChangedEvent>;
  listPackages(): Promise<readonly ModelPackage[]>;
  getPackage(id: string): Promise<ModelPackage | undefined>;
  createPackage(input: ModelPackageCreateInput): Promise<ModelPackage | undefined>;
  listEndpoints(): Promise<readonly ServingEndpoint[]>;
  getEndpoint(id: string): Promise<ServingEndpoint | undefined>;
  deploy(input: ServingEndpointCreateInput): Promise<ServingEndpoint | undefined>;
  action(id: string, action: 'pause' | 'resume' | 'archive' | 'rollback', input: ServingEndpointActionInput): Promise<ServingEndpoint | undefined>;
}

export const IWorkspaceServingService: ServiceIdentifier<IWorkspaceServingService> =
  createDecorator<IWorkspaceServingService>('servingService');

export type {
  ModelPackage,
  ModelPackageCreateInput,
  ServingEndpoint,
  ServingEndpointActionInput,
  ServingEndpointCreateInput,
} from '@spiderbyte/protocol';
