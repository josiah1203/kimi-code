/** `datasets` domain — durable workspace datasets and native analysis operations. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type {
  Dataset,
  DatasetCreateInput,
  DatasetProfile,
  DatasetProfileInput,
  DatasetQueryInput,
  DatasetQueryResult,
  DatasetTransformInput,
  DatasetVersionCreateInput,
} from '@moonshot-ai/protocol';

export interface IWorkspaceDatasetService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  list(): Promise<readonly Dataset[]>;
  get(id: string): Promise<Dataset | undefined>;
  create(input: DatasetCreateInput): Promise<Dataset>;
  createVersion(id: string, input: DatasetVersionCreateInput): Promise<Dataset | undefined>;
  profile(id: string, input: DatasetProfileInput): Promise<DatasetProfile | undefined>;
  query(id: string, input: DatasetQueryInput): Promise<DatasetQueryResult | undefined>;
  transform(id: string, input: DatasetTransformInput): Promise<Dataset | undefined>;
}

export const IWorkspaceDatasetService: ServiceIdentifier<IWorkspaceDatasetService> =
  createDecorator<IWorkspaceDatasetService>('datasetService');
