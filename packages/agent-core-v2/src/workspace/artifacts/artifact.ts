/** Content-addressed workspace artifacts and lineage. */

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';
import type { Event } from '#/_base/event';
import type {
  Artifact,
  ArtifactDownloadChunk,
  ArtifactCreateInput,
  ArtifactDownload,
  ArtifactExpireInput,
  ArtifactKind,
  ArtifactLineage,
  ArtifactDownloadRangeInput,
} from '@moonshot-ai/protocol';

export interface WorkspaceArtifactsChangedEvent {
  readonly artifact: Artifact;
  readonly kind: 'created' | 'expired';
}

export interface IWorkspaceArtifactService {
  readonly _serviceBrand: undefined;
  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceArtifactsChangedEvent>;
  list(kind?: ArtifactKind): Promise<readonly Artifact[]>;
  get(id: string): Promise<Artifact | undefined>;
  create(input: ArtifactCreateInput): Promise<Artifact>;
  download(id: string): Promise<ArtifactDownload | undefined>;
  /** Read one bounded, resumable byte range without putting the whole blob in a transcript. */
  downloadRange(id: string, input?: ArtifactDownloadRangeInput): Promise<ArtifactDownloadChunk | undefined>;
  lineage(id: string): Promise<ArtifactLineage | undefined>;
  expire(id: string, input: ArtifactExpireInput): Promise<Artifact | undefined>;
}

export const IWorkspaceArtifactService: ServiceIdentifier<IWorkspaceArtifactService> =
  createDecorator<IWorkspaceArtifactService>('artifactService');
