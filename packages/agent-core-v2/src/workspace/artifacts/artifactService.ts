/** Durable content-addressed artifacts with inspect/download/lineage support. */

import { createHash } from 'node:crypto';
import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { Emitter, type Event } from '#/_base/event';
import { IBlobStore } from '#/persistence/interface/blobStore';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspacePlatformEventService } from '#/workspace/platformEvents/platformEvents';
import {
  artifactCreateInputSchema,
  artifactDownloadChunkSchema,
  artifactDownloadSchema,
  artifactDownloadRangeInputSchema,
  artifactExpireInputSchema,
  artifactLineageSchema,
  artifactSchema,
  nowIsoDateTime,
  type Artifact,
  type ArtifactCreateInput,
  type ArtifactDownloadChunk,
  type ArtifactDownload,
  type ArtifactDownloadRangeInput,
  type ArtifactExpireInput,
  type ArtifactKind,
  type ArtifactLineage,
} from '@moonshot-ai/protocol';

import { IWorkspaceArtifactService, type WorkspaceArtifactsChangedEvent } from './artifact';
import { ArtifactErrors, ArtifactServiceError } from './errors';

const ARTIFACT_KEY = 'artifacts.json';
const BLOB_SCOPE_SUFFIX = 'platform/artifacts';
const DOCUMENT_VERSION = 1;
const MAX_RANGE_BYTES = 8 * 1024 * 1024;

const artifactDocumentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  artifacts: z.array(artifactSchema),
  requests: z.record(z.string(), z.string()).default({}),
});

type ArtifactDocument = z.infer<typeof artifactDocumentSchema>;

const unsafeMetadataKey = /(?:api.?key|access.?token|refresh.?token|token(?!_ref)|password|private.?key|authorization|credential(?!_ref)|secret(?!_ref)|cookie)/i;

export class WorkspaceArtifactService extends Disposable implements IWorkspaceArtifactService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly onDidChange: Event<WorkspaceArtifactsChangedEvent>;

  private readonly changes = this._register(new Emitter<WorkspaceArtifactsChangedEvent>());
  private readonly scope: string;
  private readonly blobScope: string;
  private artifacts: readonly Artifact[] = [];
  private requests: Record<string, string> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IBlobStore private readonly blobs: IBlobStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspacePlatformEventService private readonly events: IWorkspacePlatformEventService,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.blobScope = `${context.persistenceScope}/${BLOB_SCOPE_SUFFIX}`;
    this.onDidChange = this.changes.event;
    this.ready = this.load();
  }

  async list(kind?: ArtifactKind): Promise<readonly Artifact[]> {
    await this.ready;
    return this.artifacts.filter((artifact) => kind === undefined || artifact.kind === kind);
  }

  async get(id: string): Promise<Artifact | undefined> {
    await this.ready;
    return this.artifacts.find((artifact) => artifact.id === id);
  }

  async create(input: ArtifactCreateInput): Promise<Artifact> {
    const command = artifactCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      const sourceIds = command.source_artifact_ids ?? [];
      for (const sourceId of sourceIds) this.require(sourceId);

      const content = decodeBase64(command.content_base64);
      const sha256 = createHash('sha256').update(content).digest('hex');
      const blobKey = `sha256/${sha256}`;
      if (!(await this.blobs.has(this.blobScope, blobKey))) {
        await this.blobs.put(this.blobScope, blobKey, content);
      }
      const now = nowIsoDateTime();
      const artifact = artifactSchema.parse({
        id: `artifact_${ulid()}`,
        workspace_id: this.context.workspaceId,
        run_id: command.run_id,
        name: command.name,
        kind: command.kind,
        version: 1,
        content_ref: `blob_${sha256}`,
        media_type: command.media_type,
        size_bytes: content.byteLength,
        sha256,
        created_at: now,
        expires_at: command.expires_at,
        source_artifact_ids: sourceIds.length > 0 ? sourceIds : undefined,
        metadata: command.metadata,
      });
      await this.replace([...this.artifacts, artifact], {
        ...this.requests,
        [command.request_id]: artifact.id,
      });
      await this.events.append({
        event_type: 'artifact.created',
        entity_type: 'artifact',
        entity_id: artifact.id,
        request_id: command.request_id,
        actor: 'agent',
        payload: { kind: artifact.kind, sha256: artifact.sha256, run_id: artifact.run_id },
      });
      this.changes.fire({ artifact, kind: 'created' });
      return artifact;
    });
  }

  async download(id: string): Promise<ArtifactDownload | undefined> {
    await this.ready;
    const loaded = await this.readVerified(id);
    if (loaded === undefined) return undefined;
    const { artifact, content } = loaded;
    return artifactDownloadSchema.parse({
      artifact,
      content_base64: Buffer.from(content).toString('base64'),
    });
  }

  async downloadRange(
    id: string,
    input?: ArtifactDownloadRangeInput,
  ): Promise<ArtifactDownloadChunk | undefined> {
    await this.ready;
    const command = artifactDownloadRangeInputSchema.parse(input ?? {});
    const artifact = this.artifacts.find((candidate) => candidate.id === id);
    if (artifact === undefined) return undefined;
    const hash = this.requireReadableHash(artifact);
    const totalBytes = artifact.size_bytes ?? (await this.readVerified(id))?.content.byteLength;
    if (totalBytes === undefined) return undefined;
    const start = command.start;
    const end = command.end === undefined
      ? Math.min(totalBytes - 1, start + MAX_RANGE_BYTES - 1)
      : Math.min(command.end, totalBytes - 1);
    if (start >= totalBytes || end < start || end - start + 1 > MAX_RANGE_BYTES) {
      throw new ArtifactServiceError(
        ArtifactErrors.codes.ARTIFACT_INVALID_CONTENT,
        `artifact byte range is invalid: ${id}`,
        { id, start, end },
      );
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of this.blobs.getStream(this.blobScope, `sha256/${hash}`, { start, end })) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return artifactDownloadChunkSchema.parse({
      artifact,
      start,
      end,
      total_bytes: totalBytes,
      content_base64: content.toString('base64'),
      complete: end === totalBytes - 1,
    });
  }

  async lineage(id: string): Promise<ArtifactLineage | undefined> {
    await this.ready;
    const artifact = this.artifacts.find((candidate) => candidate.id === id);
    if (artifact === undefined) return undefined;
    const sourceIds = new Set(artifact.source_artifact_ids ?? []);
    const upstream = this.artifacts.filter((candidate) => sourceIds.has(candidate.id));
    const downstream = this.artifacts.filter((candidate) =>
      (candidate.source_artifact_ids ?? []).includes(id),
    );
    return artifactLineageSchema.parse({
      artifact,
      upstream_artifacts: upstream,
      downstream_artifacts: downstream,
      downstream_run_ids: [...new Set(downstream.flatMap((candidate) =>
        candidate.run_id === undefined ? [] : [candidate.run_id],
      ))],
    });
  }

  async expire(id: string, input: ArtifactExpireInput): Promise<Artifact | undefined> {
    const command = artifactExpireInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.require(id);
      const mapped = this.requests[command.request_id];
      if (mapped !== undefined) return this.require(mapped);
      const next = artifactSchema.parse({ ...current, expires_at: command.expires_at });
      await this.replace(
        this.artifacts.map((artifact) => (artifact.id === id ? next : artifact)),
        { ...this.requests, [command.request_id]: id },
      );
      await this.events.append({
        event_type: 'artifact.archived',
        entity_type: 'artifact',
        entity_id: id,
        request_id: command.request_id,
        actor: 'system',
        payload: { expires_at: command.expires_at },
      });
      this.changes.fire({ artifact: next, kind: 'expired' });
      return next;
    });
  }

  private require(id: string): Artifact {
    const artifact = this.artifacts.find((candidate) => candidate.id === id);
    if (artifact === undefined) {
      throw new ArtifactServiceError(ArtifactErrors.codes.ARTIFACT_NOT_FOUND, `artifact not found: ${id}`, { id });
    }
    return artifact;
  }

  private requireReadableHash(artifact: Artifact): string {
    const hash = artifact.sha256;
    if (hash === undefined) {
      throw new ArtifactServiceError(
        ArtifactErrors.codes.ARTIFACT_MISSING_HASH,
        `artifact has no content hash: ${artifact.id}`,
        { id: artifact.id },
      );
    }
    if (artifact.expires_at !== undefined && Date.parse(artifact.expires_at) <= Date.now()) {
      throw new ArtifactServiceError(
        ArtifactErrors.codes.ARTIFACT_EXPIRED,
        `artifact has expired: ${artifact.id}`,
        { id: artifact.id },
      );
    }
    return hash;
  }

  private async readVerified(
    id: string,
  ): Promise<{ readonly artifact: Artifact; readonly content: Uint8Array } | undefined> {
    const artifact = this.artifacts.find((candidate) => candidate.id === id);
    if (artifact === undefined) return undefined;
    const hash = this.requireReadableHash(artifact);
    const content = await this.blobs.get(this.blobScope, `sha256/${hash}`);
    if (content === undefined) return undefined;
    const actualHash = createHash('sha256').update(content).digest('hex');
    if (actualHash !== hash) {
      throw new ArtifactServiceError(
        ArtifactErrors.codes.ARTIFACT_INVALID_CONTENT,
        `artifact content hash does not match its metadata: ${id}`,
        { id },
      );
    }
    return { artifact, content };
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, ARTIFACT_KEY);
    if (raw === undefined) {
      await this.replace([], {});
      return;
    }
    const document = artifactDocumentSchema.parse(raw);
    this.artifacts = document.artifacts;
    this.requests = document.requests;
  }

  private async replace(artifacts: readonly Artifact[], requests: Record<string, string>): Promise<void> {
    const document: ArtifactDocument = {
      version: DOCUMENT_VERSION,
      artifacts: [...artifacts],
      requests,
    };
    await this.store.set(this.scope, ARTIFACT_KEY, document);
    this.artifacts = document.artifacts;
    this.requests = document.requests;
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(normalized) || normalized.length % 4 === 1) {
    throw new ArtifactServiceError(
      ArtifactErrors.codes.ARTIFACT_INVALID_CONTENT,
      'artifact content is not valid base64',
    );
  }
  const content = Buffer.from(value, 'base64');
  const canonical = content.toString('base64').replace(/=+$/, '');
  if (canonical !== normalized) {
    throw new ArtifactServiceError(
      ArtifactErrors.codes.ARTIFACT_INVALID_CONTENT,
      'artifact content is not valid base64',
    );
  }
  return Uint8Array.from(content);
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  if (metadata === undefined) return;
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => { visit(item, `${path}[${index}]`); });
      return;
    }
    if (value === null || typeof value !== 'object') return;
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = path.length === 0 ? key : `${path}.${key}`;
      if (unsafeMetadataKey.test(key)) {
        throw new ArtifactServiceError(
          ArtifactErrors.codes.ARTIFACT_SECRET_MATERIAL,
          `artifact metadata cannot contain secret material in '${nextPath}'`,
          { key: nextPath },
        );
      }
      visit(nested, nextPath);
    }
  };
  visit(metadata, 'metadata');
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceArtifactService,
  WorkspaceArtifactService,
  ScopeActivation.OnScopeCreated,
  'artifacts',
);
