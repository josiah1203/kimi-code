import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SyncDescriptor } from '#/_base/di/descriptors';
import { DisposableStore } from '#/_base/di/lifecycle';
import { TestInstantiationService } from '#/_base/di/test';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { JsonAtomicDocumentStore } from '#/persistence/backends/node-fs/atomicDocumentStore';
import { IFileSystemStorageService } from '#/persistence/interface/storage';
import { InMemoryStorageService } from '#/persistence/backends/memory/inMemoryStorageService';
import { ISessionProcessRunner, type ProcessExecOptions } from '#/session/process/processRunner';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceFsService } from '#/workspace/workspaceFs/fs';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { IWorkspaceDatasetService } from '#/workspace/datasets/dataset';
import { WorkspaceDatasetService } from '#/workspace/datasets/datasetService';
import type { IWorkspaceContext as WorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import type { ArtifactCreateInput } from '@spiderbyte/protocol';

const context: WorkspaceContext = {
  _serviceBrand: undefined,
  workspaceId: 'wd_workspace_dataset_0123456789ab',
  cwd: '/tmp/workspace-dataset',
  source: 'local',
  meta: {
    id: 'wd_workspace_dataset_0123456789ab',
    root: '/tmp/workspace-dataset',
    name: 'dataset-test',
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
  },
  persistenceScope: 'workspaces/wd_workspace_dataset_0123456789ab',
  osBackendId: 'local',
  persistenceBackendId: 'local',
};

describe('WorkspaceDatasetService', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IWorkspaceContext, context);
    ix.set(IFileSystemStorageService, new SyncDescriptor(InMemoryStorageService));
    ix.set(IAtomicDocumentStore, new SyncDescriptor(JsonAtomicDocumentStore));
    ix.stub(IWorkspaceFsService, {
      _serviceBrand: undefined,
      read: async () => ({
        path: 'sales.csv',
        content: 'name,amount\nalpha,2\nbeta,3\n',
        encoding: 'utf-8',
        size: 29,
        truncated: false,
        etag: 'etag',
        mime: 'text/csv',
        is_binary: false,
      }),
    } as unknown as IWorkspaceFsService);
    const contents = new Map<string, string>();
    const artifacts = new Map<string, Record<string, unknown>>();
    let artifactNumber = 0;
    ix.stub(IWorkspaceArtifactService, {
      _serviceBrand: undefined,
      create: async (input: ArtifactCreateInput) => {
        const id = `artifact_dataset_${++artifactNumber}`;
        contents.set(id, input.content_base64);
        const artifact = {
          id,
          workspace_id: context.workspaceId,
          run_id: input.run_id,
          name: input.name,
          kind: input.kind,
          version: 1,
          content_ref: `blob_${id}`,
          media_type: input.media_type,
          size_bytes: Buffer.from(input.content_base64, 'base64').byteLength,
          sha256: 'a'.repeat(64),
          created_at: new Date().toISOString(),
          source_artifact_ids: input.source_artifact_ids,
          metadata: input.metadata,
        };
        artifacts.set(id, artifact);
        return artifact;
      },
      download: async (id: string) => {
        const content_base64 = contents.get(id);
        if (content_base64 === undefined) return undefined;
        return {
          artifact: artifacts.get(id) as never,
          content_base64,
        };
      },
    } as unknown as IWorkspaceArtifactService);
    ix.stub(IWorkspacePolicyService, {
      _serviceBrand: undefined,
      evaluate: async (input: { readonly request_id: string; readonly run_id?: string; readonly action: string; readonly requested_by: 'agent' }) => ({
        id: `policy_${input.request_id}`,
        workspace_id: context.workspaceId,
        run_id: input.run_id,
        capability: 'dataset',
        action: input.action,
        state: 'evaluated',
        outcome: 'allow',
        reason: 'test policy',
        requested_by: input.requested_by,
        requested_at: new Date().toISOString(),
        evaluated_at: new Date().toISOString(),
      }),
      get: async () => undefined,
    } as unknown as IWorkspacePolicyService);
    ix.stub(ISessionProcessRunner, {
      _serviceBrand: undefined,
      exec: async (_command: readonly string[], options?: ProcessExecOptions) => {
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const jsonl = options?.env?.['SPIDERBYTE_DATASET_FORMAT'] === 'jsonl';
        stdout.end(JSON.stringify(jsonl
          ? { columns: ['name', 'amount'], rows: [['beta', 3], ['alpha', 2]], truncated: false }
          : { columns: ['name'], rows: [['alpha']], truncated: false }));
        stderr.end();
        return {
          stdin: new PassThrough(),
          stdout,
          stderr,
          pid: 1,
          exitCode: 0,
          wait: async () => 0,
          kill: async () => undefined,
          dispose: () => undefined,
        };
      },
    } as unknown as ISessionProcessRunner);
    ix.set(IWorkspaceDatasetService, new SyncDescriptor(WorkspaceDatasetService));
  });

  afterEach(() => disposables.dispose());

  it('registers versions, profiles data, persists metadata, and returns SQL artifacts', async () => {
    const service = ix.get(IWorkspaceDatasetService);
    const dataset = await service.create({
      request_id: 'dataset_create',
      name: 'sales',
      source_path: 'sales.csv',
    });
    expect(dataset).toMatchObject({ current_version: 1, versions: [{ row_count: 2 }] });

    const versioned = await service.createVersion(dataset.id, {
      request_id: 'dataset_version',
      content_base64: Buffer.from('name,amount\ngamma,4\n').toString('base64'),
    });
    expect(versioned?.current_version).toBe(2);

    const profile = await service.profile(dataset.id, { request_id: 'dataset_profile', version: 1 });
    expect(profile).toMatchObject({ dataset_id: dataset.id, row_count: 2, artifact_id: expect.any(String) });
    await expect(service.profile(dataset.id, { request_id: 'dataset_profile', version: 1 })).resolves.toEqual(profile);

    const result = await service.query(dataset.id, {
      request_id: 'dataset_query',
      sql: 'SELECT name FROM dataset LIMIT 1',
      version: 1,
    });
    expect(result).toMatchObject({
      dataset_id: dataset.id,
      columns: ['name'],
      rows: [['alpha']],
      artifact_id: expect.any(String),
    });
    await expect(service.query(dataset.id, {
      request_id: 'dataset_query',
      sql: 'SELECT name FROM dataset LIMIT 1',
      version: 1,
    })).resolves.toEqual(result);

    const transformed = await service.transform(dataset.id, {
      request_id: 'dataset_transform',
      sql: 'SELECT name FROM dataset',
      version: 1,
      metadata: { feature_set: 'names_only' },
    });
    expect(transformed).toMatchObject({
      current_version: 3,
      versions: [
        {},
        {},
        {
          row_count: 1,
          columns: [{ name: 'name' }],
          metadata: { transform: 'sql', source_version: 1, feature_set: 'names_only' },
        },
      ],
    });

    const stored = await ix
      .get(IAtomicDocumentStore)
      .get<unknown>('workspaces/wd_workspace_dataset_0123456789ab/platform', 'datasets.json');
    expect(JSON.stringify(stored)).toContain(dataset.id);
  });

  it('ingests JSONL, infers fields, and runs native SQL against the version', async () => {
    const service = ix.get(IWorkspaceDatasetService);
    const dataset = await service.create({
      request_id: 'jsonl_create',
      name: 'events',
      format: 'jsonl',
      content_base64: Buffer.from(
        '{"name":"alpha","amount":2,"active":true}\n{"name":"beta","amount":3}\n',
      ).toString('base64'),
    });

    expect(dataset).toMatchObject({
      format: 'jsonl',
      current_version: 1,
      versions: [{ row_count: 2, columns: [
        { name: 'name', type: 'string', nullable: false },
        { name: 'amount', type: 'integer', nullable: false },
        { name: 'active', type: 'boolean', nullable: true },
      ] }],
    });

    const profile = await service.profile(dataset.id, { request_id: 'jsonl_profile' });
    expect(profile).toMatchObject({ row_count: 2 });
    expect(profile?.columns.find((column) => column.name === 'amount')).toMatchObject({ type: 'integer' });

    const result = await service.query(dataset.id, {
      request_id: 'jsonl_query',
      sql: 'SELECT name, amount FROM dataset ORDER BY amount DESC',
    });
    expect(result).toMatchObject({
      columns: ['name', 'amount'],
      rows: [['beta', 3], ['alpha', 2]],
      row_count: 2,
    });
  });
});
