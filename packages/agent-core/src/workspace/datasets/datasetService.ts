/**
 * `datasets` domain — `IWorkspaceDatasetService` implementation.
 *
 * Ingests bounded local CSV and JSONL data through the workspace filesystem service,
 * stores immutable source and result bytes through the artifact service, and
 * persists dataset/version metadata through the workspace atomic store. SQL is
 * executed by the configured process runner in an isolated in-memory SQLite
 * adapter; no user SQL is interpolated into a shell command. Bound at
 * Workspace scope.
 */

import { ulid } from 'ulid';
import { z } from 'zod';

import { Disposable } from '#/_base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { ISessionProcessRunner, type IProcess } from '#/session/process/processRunner';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceFsService } from '#/workspace/workspaceFs/fs';
import { IWorkspaceArtifactService } from '#/workspace/artifacts/artifact';
import { IWorkspacePolicyService } from '#/workspace/policy/policy';
import { findSensitivePlatformMetadataPath } from '#/workspace/platformServices/metadata';
import {
  artifactDownloadSchema,
  datasetCreateInputSchema,
  datasetProfileInputSchema,
  datasetProfileSchema,
  datasetQueryInputSchema,
  datasetQueryResultSchema,
  datasetSchema,
  datasetTransformInputSchema,
  datasetVersionCreateInputSchema,
  nowIsoDateTime,
  type Dataset,
  type DatasetColumn,
  type DatasetCreateInput,
  type DatasetProfile,
  type DatasetProfileInput,
  type DatasetQueryInput,
  type DatasetQueryResult,
  type DatasetTransformInput,
  type DatasetVersion,
  type DatasetVersionCreateInput,
} from '@spiderbyte/protocol';

import { IWorkspaceDatasetService } from './dataset';
import { DatasetErrors, DatasetServiceError } from './errors';

const DATASETS_KEY = 'datasets.json';
const DOCUMENT_VERSION = 1;
const MAX_DATASET_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 500_000;
const SQL_TIMEOUT_MS = 30_000;
const SQL_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

const datasetDocumentSchema = z.strictObject({
  version: z.literal(DOCUMENT_VERSION),
  datasets: z.array(datasetSchema),
  requests: z.record(z.string(), z.string()).default({}),
  request_results: z.record(z.string(), z.strictObject({
    kind: z.enum(['profile', 'query']),
    artifact_id: z.string().min(1),
  })).default({}),
});

type DatasetDocument = z.infer<typeof datasetDocumentSchema>;
type DatasetRequestResult = DatasetDocument['request_results'][string];

export class WorkspaceDatasetService extends Disposable implements IWorkspaceDatasetService {
  declare readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  private readonly scope: string;
  private datasets: readonly Dataset[] = [];
  private requests: Record<string, string> = {};
  private requestResults: Record<string, DatasetRequestResult> = {};
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @IWorkspaceContext private readonly context: IWorkspaceContext,
    @IWorkspaceFsService private readonly fs: IWorkspaceFsService,
    @IWorkspaceArtifactService private readonly artifacts: IWorkspaceArtifactService,
    @IWorkspacePolicyService private readonly policy: IWorkspacePolicyService,
    @ISessionProcessRunner private readonly processes: ISessionProcessRunner,
  ) {
    super();
    this.scope = `${context.persistenceScope}/platform`;
    this.ready = this.load();
  }

  async list(): Promise<readonly Dataset[]> {
    await this.ready;
    return [...this.datasets];
  }

  async get(id: string): Promise<Dataset | undefined> {
    await this.ready;
    return this.datasets.find((dataset) => dataset.id === id);
  }

  async create(input: DatasetCreateInput): Promise<Dataset> {
    const command = datasetCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      await this.assertPolicy(
        command.request_id,
        undefined,
        `dataset.register:${command.name}`,
        command.policy_decision_id,
      );
      const content = await this.readInput(command);
      const inspected = inspectDatasetContent(content, command.format);
      const id = `dataset_${ulid()}`;
      const extension = command.format === 'jsonl' ? 'jsonl' : 'csv';
      const artifact = await this.artifacts.create({
        request_id: `${command.request_id}:source`,
        run_id: command.run_id,
        name: `${command.name}.${extension}`,
        kind: 'dataset',
        content_base64: Buffer.from(content, 'utf8').toString('base64'),
        media_type: mediaTypeFor(command.format),
        metadata: { dataset_id: id, version: 1 },
      });
      const now = nowIsoDateTime();
      const version: DatasetVersion = {
        version: 1,
        artifact_id: artifact.id,
        row_count: inspected.rowCount,
        columns: [...inspected.columns],
        created_at: now,
        metadata: command.metadata,
      };
      const dataset = datasetSchema.parse({
        id,
        workspace_id: this.context.workspaceId,
        name: command.name,
        format: command.format,
        source_path: command.source_path,
        current_version: 1,
        versions: [version],
        created_at: now,
        updated_at: now,
        metadata: command.metadata,
      });
      await this.replace([...this.datasets, dataset], {
        ...this.requests,
        [command.request_id]: dataset.id,
      });
      return dataset;
    });
  }

  async createVersion(
    id: string,
    input: DatasetVersionCreateInput,
  ): Promise<Dataset | undefined> {
    const command = datasetVersionCreateInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.datasets.find((dataset) => dataset.id === id);
      if (current === undefined) return undefined;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      await this.assertPolicy(
        command.request_id,
        undefined,
        `dataset.version:${id}`,
        command.policy_decision_id,
      );
      const content = await this.readInput(command);
      const inspected = inspectDatasetContent(content, current.format);
      const versionNumber = current.current_version + 1;
      const extension = current.format === 'jsonl' ? 'jsonl' : 'csv';
      const artifact = await this.artifacts.create({
        request_id: `${command.request_id}:source`,
        run_id: command.run_id,
        name: `${current.name}.v${versionNumber}.${extension}`,
        kind: 'dataset',
        content_base64: Buffer.from(content, 'utf8').toString('base64'),
        media_type: mediaTypeFor(current.format),
        source_artifact_ids: [this.currentVersion(current).artifact_id],
        metadata: { dataset_id: id, version: versionNumber },
      });
      const version: DatasetVersion = {
        version: versionNumber,
        artifact_id: artifact.id,
        row_count: inspected.rowCount,
        columns: [...inspected.columns],
        created_at: nowIsoDateTime(),
        metadata: command.metadata,
      };
      const next = datasetSchema.parse({
        ...current,
        current_version: versionNumber,
        versions: [...current.versions, version],
        updated_at: nowIsoDateTime(),
      });
      await this.replace(
        this.datasets.map((dataset) => (dataset.id === id ? next : dataset)),
        { ...this.requests, [command.request_id]: id },
      );
      return next;
    });
  }

  async profile(id: string, input: DatasetProfileInput): Promise<DatasetProfile | undefined> {
    const command = datasetProfileInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const previous = this.requestResults[command.request_id];
      if (previous !== undefined) {
        if (previous.kind !== 'profile') {
          throw new DatasetServiceError(
            DatasetErrors.codes.DATASET_INPUT_INVALID,
            `request id was already used for a ${previous.kind} operation`,
          );
        }
        return this.readProfileResult(previous.artifact_id);
      }
      const dataset = this.datasets.find((candidate) => candidate.id === id);
      if (dataset === undefined) return undefined;
      const version = this.version(dataset, command.version);
      await this.assertPolicy(
        command.request_id,
        command.run_id,
        `dataset.profile:${id}`,
        command.policy_decision_id,
      );
      const content = await this.versionContent(version);
      const inspected = inspectDatasetContent(content, dataset.format);
      const generatedAt = nowIsoDateTime();
      const artifact = await this.artifacts.create({
        request_id: command.request_id,
        run_id: command.run_id,
        name: `${dataset.name}.profile.json`,
        kind: 'metrics',
        content_base64: Buffer.from(JSON.stringify({
          dataset_id: id,
          version: version.version,
          row_count: inspected.rowCount,
          columns: inspected.columns,
          generated_at: generatedAt,
        }), 'utf8').toString('base64'),
        media_type: 'application/json',
        source_artifact_ids: [version.artifact_id],
        metadata: { dataset_id: id, version: version.version, attempt_id: command.attempt_id },
      });
      const result = datasetProfileSchema.parse({
        dataset_id: id,
        version: version.version,
        row_count: inspected.rowCount,
        columns: inspected.columns,
        artifact_id: artifact.id,
        generated_at: generatedAt,
      });
      const nextVersion = {
        ...version,
        profile_artifact_ids: [...(version.profile_artifact_ids ?? []), artifact.id],
      };
      const next = datasetSchema.parse({
        ...dataset,
        versions: dataset.versions.map((candidate) =>
          candidate.version === version.version ? nextVersion : candidate,
        ),
        updated_at: nowIsoDateTime(),
      });
      await this.replace(
        this.datasets.map((candidate) => (candidate.id === id ? next : candidate)),
        this.requests,
        { ...this.requestResults, [command.request_id]: { kind: 'profile', artifact_id: artifact.id } },
      );
      return result;
    });
  }

  async query(id: string, input: DatasetQueryInput): Promise<DatasetQueryResult | undefined> {
    const command = datasetQueryInputSchema.parse(input);
    return this.enqueue(async () => {
      await this.ready;
      const previous = this.requestResults[command.request_id];
      if (previous !== undefined) {
        if (previous.kind !== 'query') {
          throw new DatasetServiceError(
            DatasetErrors.codes.DATASET_INPUT_INVALID,
            `request id was already used for a ${previous.kind} operation`,
          );
        }
        return this.readQueryResult(previous.artifact_id);
      }
      const dataset = this.datasets.find((candidate) => candidate.id === id);
      if (dataset === undefined) return undefined;
      const version = this.version(dataset, command.version);
      const policy = await this.assertPolicy(
        command.request_id,
        command.run_id,
        `dataset.query:${id}`,
        command.policy_decision_id,
      );
      const content = await this.versionContent(version);
      const result = await runSqliteQuery(this.processes, content, dataset.format, command.sql, command.max_rows);
      const artifact = await this.artifacts.create({
        request_id: command.request_id,
        run_id: command.run_id,
        name: `${dataset.name}.query.json`,
        kind: 'table',
        content_base64: Buffer.from(JSON.stringify({
          dataset_id: id,
          version: version.version,
          columns: result.columns,
          rows: result.rows,
          row_count: result.rows.length,
          truncated: result.truncated,
          run_id: command.run_id,
          policy_decision_id: policy.id,
        }), 'utf8').toString('base64'),
        media_type: 'application/json',
        source_artifact_ids: [version.artifact_id],
        metadata: { dataset_id: id, version: version.version, query: 'redacted' },
      });
      await this.replace(
        this.datasets,
        this.requests,
        { ...this.requestResults, [command.request_id]: { kind: 'query', artifact_id: artifact.id } },
      );
      return datasetQueryResultSchema.parse({
        dataset_id: id,
        version: version.version,
        columns: result.columns,
        rows: result.rows,
        row_count: result.rows.length,
        truncated: result.truncated,
        artifact_id: artifact.id,
        run_id: command.run_id,
        policy_decision_id: policy.id,
      });
    });
  }

  async transform(id: string, input: DatasetTransformInput): Promise<Dataset | undefined> {
    const command = datasetTransformInputSchema.parse(input);
    assertSafeMetadata(command.metadata);
    return this.enqueue(async () => {
      await this.ready;
      const current = this.datasets.find((candidate) => candidate.id === id);
      if (current === undefined) return undefined;
      const existingId = this.requests[command.request_id];
      if (existingId !== undefined) return this.require(existingId);
      const version = this.version(current, command.version);
      await this.assertPolicy(
        command.request_id,
        command.run_id,
        `dataset.transform:${id}`,
        command.policy_decision_id,
      );
      const content = await this.versionContent(version);
      const result = await runSqliteQuery(this.processes, content, current.format, command.sql, command.max_rows);
      if (result.truncated) {
        throw new DatasetServiceError(
          DatasetErrors.codes.DATASET_TOO_LARGE,
          `dataset transformation exceeds the ${command.max_rows}-row result limit`,
        );
      }
      const transformed = serializeDataset(current.format, result.columns, result.rows);
      const transformedBytes = Buffer.byteLength(transformed, 'utf8');
      if (transformedBytes > MAX_DATASET_BYTES) {
        throw new DatasetServiceError(
          DatasetErrors.codes.DATASET_TOO_LARGE,
          `transformed dataset exceeds the ${MAX_DATASET_BYTES}-byte limit`,
        );
      }
      const nextVersionNumber = current.current_version + 1;
      const extension = current.format === 'jsonl' ? 'jsonl' : 'csv';
      const artifact = await this.artifacts.create({
        request_id: `${command.request_id}:source`,
        run_id: command.run_id,
        name: `${current.name}.v${nextVersionNumber}.${extension}`,
        kind: 'dataset',
        content_base64: Buffer.from(transformed, 'utf8').toString('base64'),
        media_type: mediaTypeFor(current.format),
        source_artifact_ids: [version.artifact_id],
        metadata: {
          ...command.metadata,
          dataset_id: id,
          version: nextVersionNumber,
          transform: 'sql',
          query: 'redacted',
        },
      });
      const inspected = inspectDatasetContent(transformed, current.format);
      const next = datasetSchema.parse({
        ...current,
        current_version: nextVersionNumber,
        versions: [...current.versions, {
          version: nextVersionNumber,
          artifact_id: artifact.id,
          row_count: inspected.rowCount,
          columns: [...inspected.columns],
          created_at: nowIsoDateTime(),
          metadata: {
            ...command.metadata,
            transform: 'sql',
            source_version: version.version,
          },
        }],
        updated_at: nowIsoDateTime(),
      });
      await this.replace(
        this.datasets.map((candidate) => (candidate.id === id ? next : candidate)),
        { ...this.requests, [command.request_id]: id },
        this.requestResults,
      );
      return next;
    });
  }

  private async assertPolicy(
    requestId: string,
    runId: string | undefined,
    action: string,
    decisionId: string | undefined,
  ) {
    if (decisionId !== undefined) {
      try {
        return await this.policy.assertUsable(decisionId, {
          capability: 'dataset',
          action,
          run_id: runId,
        });
      } catch (error) {
        throw new DatasetServiceError(
          DatasetErrors.codes.DATASET_POLICY_REQUIRED,
          `dataset action does not have an approved policy decision: ${decisionId}`,
          { policyDecisionId: decisionId, cause: error instanceof Error ? error.message : String(error) },
        );
      }
    }
    const decision = await this.policy.evaluate({
      request_id: `${requestId}:policy`,
      run_id: runId,
      capability: 'dataset',
      action,
      requested_by: 'agent',
      metadata: { source: 'dataset_service' },
    });
    if (decision.outcome !== 'allow') {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_POLICY_REQUIRED,
        `dataset action requires policy approval: ${decision.reason}`,
        { policyDecisionId: decision.id },
      );
    }
    return decision;
  }

  private async readInput(input: {
    readonly source_path?: string;
    readonly content_base64?: string;
  }): Promise<string> {
    if (input.source_path !== undefined && input.content_base64 !== undefined) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_INPUT_INVALID,
        'dataset input must provide either source_path or content_base64, not both',
      );
    }
    if (input.source_path !== undefined) {
      const result = await this.fs.read({
        path: input.source_path,
        offset: 0,
        length: MAX_DATASET_BYTES,
        encoding: 'utf-8',
      });
      if (result.truncated) {
        throw new DatasetServiceError(
          DatasetErrors.codes.DATASET_TOO_LARGE,
          `dataset exceeds the ${MAX_DATASET_BYTES}-byte ingestion limit`,
        );
      }
      return result.content;
    }
    if (input.content_base64 !== undefined) {
      const content = Buffer.from(input.content_base64, 'base64');
      if (content.byteLength > MAX_DATASET_BYTES) {
        throw new DatasetServiceError(
          DatasetErrors.codes.DATASET_TOO_LARGE,
          `dataset exceeds the ${MAX_DATASET_BYTES}-byte ingestion limit`,
        );
      }
      return content.toString('utf8');
    }
    throw new DatasetServiceError(
      DatasetErrors.codes.DATASET_INPUT_INVALID,
      'dataset input must provide source_path or content_base64',
    );
  }

  private async versionContent(version: DatasetVersion): Promise<string> {
    const downloaded = await this.artifacts.download(version.artifact_id);
    if (downloaded === undefined) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_INPUT_INVALID,
        `dataset source artifact is unavailable: ${version.artifact_id}`,
        { artifactId: version.artifact_id },
      );
    }
    const parsed = artifactDownloadSchema.parse(downloaded);
    return Buffer.from(parsed.content_base64, 'base64').toString('utf8');
  }

  private currentVersion(dataset: Dataset): DatasetVersion {
    return this.version(dataset, dataset.current_version);
  }

  private version(dataset: Dataset, requested: number | undefined): DatasetVersion {
    const versionNumber = requested ?? dataset.current_version;
    const version = dataset.versions.find((candidate) => candidate.version === versionNumber);
    if (version === undefined) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_INPUT_INVALID,
        `dataset version does not exist: ${dataset.id}@${versionNumber}`,
        { datasetId: dataset.id, version: versionNumber },
      );
    }
    return version;
  }

  private require(id: string): Dataset {
    const dataset = this.datasets.find((candidate) => candidate.id === id);
    if (dataset === undefined) {
      throw new DatasetServiceError(DatasetErrors.codes.DATASET_NOT_FOUND, `dataset not found: ${id}`, { id });
    }
    return dataset;
  }

  private async load(): Promise<void> {
    const raw = await this.store.get<unknown>(this.scope, DATASETS_KEY);
    if (raw === undefined) {
      await this.replace([], {});
      return;
    }
    const document = datasetDocumentSchema.parse(raw);
    this.datasets = document.datasets;
    this.requests = document.requests;
    this.requestResults = document.request_results;
  }

  private async replace(
    datasets: readonly Dataset[],
    requests: Record<string, string>,
    requestResults: Record<string, DatasetRequestResult> = this.requestResults,
  ): Promise<void> {
    const document: DatasetDocument = {
      version: DOCUMENT_VERSION,
      datasets: [...datasets],
      requests,
      request_results: requestResults,
    };
    await this.store.set(this.scope, DATASETS_KEY, document);
    this.datasets = document.datasets;
    this.requests = document.requests;
    this.requestResults = document.request_results;
  }

  private async readProfileResult(artifactId: string): Promise<DatasetProfile> {
    const downloaded = await this.artifacts.download(artifactId);
    if (downloaded === undefined) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_INPUT_INVALID,
        `idempotent dataset profile artifact is unavailable: ${artifactId}`,
        { artifactId },
      );
    }
    try {
      const parsed = JSON.parse(Buffer.from(downloaded.content_base64, 'base64').toString('utf8')) as Record<string, unknown>;
      return datasetProfileSchema.parse({ ...parsed, artifact_id: parsed['artifact_id'] ?? artifactId });
    } catch (error) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_QUERY_FAILED,
        `idempotent dataset profile artifact is invalid: ${safeError(error)}`,
        { artifactId },
      );
    }
  }

  private async readQueryResult(artifactId: string): Promise<DatasetQueryResult> {
    const downloaded = await this.artifacts.download(artifactId);
    if (downloaded === undefined) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_INPUT_INVALID,
        `idempotent dataset query artifact is unavailable: ${artifactId}`,
        { artifactId },
      );
    }
    try {
      const parsed = JSON.parse(Buffer.from(downloaded.content_base64, 'base64').toString('utf8')) as Record<string, unknown>;
      return datasetQueryResultSchema.parse({ ...parsed, artifact_id: parsed['artifact_id'] ?? artifactId });
    } catch (error) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_QUERY_FAILED,
        `idempotent dataset query artifact is invalid: ${safeError(error)}`,
        { artifactId },
      );
    }
  }

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.mutationQueue.then(work, work);
    this.mutationQueue = next.then(() => undefined, () => undefined);
    return next;
  }
}

interface DatasetInspection {
  readonly rowCount: number;
  readonly columns: readonly DatasetColumn[];
}

function inspectDatasetContent(content: string, format: Dataset['format']): DatasetInspection {
  if (format === 'jsonl') return inspectJsonl(content);
  return inspectCsv(content);
}

function inspectCsv(content: string): DatasetInspection {
  const rows = parseCsv(content);
  const header = rows[0];
  if (header === undefined || header.length === 0) {
    throw new DatasetServiceError(DatasetErrors.codes.DATASET_INPUT_INVALID, 'CSV must contain a header row');
  }
  if (rows.length - 1 > MAX_ROWS) {
    throw new DatasetServiceError(
      DatasetErrors.codes.DATASET_TOO_LARGE,
      `dataset exceeds the ${MAX_ROWS}-row ingestion limit`,
    );
  }
  const names = header.map((name, index) => name.trim() || `column_${index + 1}`);
  const columns = names.map((name, index) => {
    const values = rows.slice(1).map((row) => row[index] ?? '');
    const nonNull = values.filter((value) => value.trim() !== '');
    return {
      name,
      type: inferColumnType(nonNull),
      nullable: nonNull.length !== values.length,
      non_null_count: nonNull.length,
      distinct_count: new Set(nonNull).size,
    } satisfies DatasetColumn;
  });
  return { rowCount: rows.length - 1, columns };
}

function inspectJsonl(content: string): DatasetInspection {
  const values = parseJsonl(content);
  if (values.length > MAX_ROWS) {
    throw new DatasetServiceError(
      DatasetErrors.codes.DATASET_TOO_LARGE,
      `dataset exceeds the ${MAX_ROWS}-row ingestion limit`,
    );
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const name of Object.keys(value)) {
      if (!seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
    }
  }
  if (names.length === 0) {
    throw new DatasetServiceError(DatasetErrors.codes.DATASET_INPUT_INVALID, 'JSONL must contain object fields');
  }
  const columns = names.map((name) => {
    const valuesForColumn = values.map((value) => value[name]);
    const present = valuesForColumn.filter((value) => value !== undefined && value !== null && value !== '');
    return {
      name,
      type: inferJsonValueType(present),
      nullable: present.length !== valuesForColumn.length,
      non_null_count: present.length,
      distinct_count: new Set(present.map((value) => JSON.stringify(value))).size,
    } satisfies DatasetColumn;
  });
  return { rowCount: values.length, columns };
}

function inferJsonValueType(values: readonly unknown[]): DatasetColumn['type'] {
  if (values.length === 0) return 'unknown';
  if (values.every((value) => typeof value === 'boolean')) return 'boolean';
  if (values.every((value) => typeof value === 'number' && Number.isInteger(value))) return 'integer';
  if (values.every((value) => typeof value === 'number' && Number.isFinite(value))) return 'number';
  if (values.every((value) => typeof value === 'string')) return 'string';
  return 'unknown';
}

function parseJsonl(content: string): readonly Record<string, unknown>[] {
  const values: Record<string, unknown>[] = [];
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_INPUT_INVALID,
        `JSONL line ${index + 1} is invalid: ${safeError(error)}`,
      );
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_INPUT_INVALID,
        `JSONL line ${index + 1} must contain a JSON object`,
      );
    }
    values.push(parsed as Record<string, unknown>);
  }
  return values;
}

function mediaTypeFor(format: Dataset['format']): string {
  return format === 'jsonl' ? 'application/x-ndjson' : 'text/csv';
}

function serializeDataset(
  format: Dataset['format'],
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): string {
  if (format === 'jsonl') {
    return rows
      .map((row) => JSON.stringify(Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null]))))
      .join('\n') + (rows.length === 0 ? '' : '\n');
  }
  return [
    columns.map(csvCell).join(','),
    ...rows.map((row) => columns.map((_column, index) => csvCell(row[index])).join(',')),
  ].join('\n') + '\n';
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'string'
    ? value
    : typeof value === 'object'
      ? JSON.stringify(value) ?? ''
      : String(value as number | boolean | bigint | symbol);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function inferColumnType(values: readonly string[]): DatasetColumn['type'] {
  if (values.length === 0) return 'unknown';
  if (values.every((value) => /^[-+]?\d+$/.test(value.trim()))) return 'integer';
  if (values.every((value) => /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim()))) {
    return 'number';
  }
  if (values.every((value) => /^(?:true|false)$/i.test(value.trim()))) return 'boolean';
  return 'string';
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < content.length; index++) {
    const char = content[index];
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        value += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"' && value.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n') {
      row.push(value.endsWith('\r') ? value.slice(0, -1) : value);
      value = '';
      if (row.some((cell) => cell.length > 0) || row.length > 1) rows.push(row);
      row = [];
    } else {
      value += char;
    }
  }
  if (quoted) {
    throw new DatasetServiceError(
      DatasetErrors.codes.DATASET_INPUT_INVALID,
      'CSV contains an unterminated quoted field',
    );
  }
  if (value.length > 0 || row.length > 0) {
    row.push(value);
    if (row.some((cell) => cell.length > 0) || row.length > 1) rows.push(row);
  }
  return rows;
}

function assertSafeMetadata(metadata: Readonly<Record<string, unknown>> | undefined): void {
  const path = findSensitivePlatformMetadataPath(metadata);
  if (path !== undefined) {
    throw new DatasetServiceError(
      DatasetErrors.codes.DATASET_SECRET_MATERIAL,
      `dataset metadata cannot contain secret material in '${path}'`,
      { key: path },
    );
  }
}

async function runSqliteQuery(
  runner: ISessionProcessRunner,
  content: string,
  format: Dataset['format'],
  sql: string,
  maxRows: number,
): Promise<{
  readonly columns: readonly string[];
  readonly rows: readonly unknown[][];
  readonly truncated: boolean;
}> {
  if (!/^\s*(?:select|with)\b/i.test(sql) || /;\s*\S/.test(sql)) {
    throw new DatasetServiceError(
      DatasetErrors.codes.DATASET_QUERY_INVALID,
      'dataset SQL must be a single read-only SELECT or WITH statement',
    );
  }
  const script = makeSqliteScript(maxRows);
  let process: IProcess;
  try {
    process = await runner.exec(['python3', '-c', script], {
      env: {
        SPIDERBYTE_DATASET_QUERY: Buffer.from(sql, 'utf8').toString('base64'),
        SPIDERBYTE_DATASET_FORMAT: format,
      },
    });
  } catch (error) {
    throw new DatasetServiceError(
      DatasetErrors.codes.DATASET_QUERY_FAILED,
      `local SQL executor is unavailable: ${safeError(error)}`,
    );
  }
  process.stdin.end(content);
  let stdout = '';
  let stderr = '';
  process.stdout.setEncoding('utf8');
  process.stderr.setEncoding('utf8');
  const timer = setTimeout(() => void process.kill('SIGKILL'), SQL_TIMEOUT_MS);
  try {
    const [exitCode] = await Promise.all([
      process.wait().catch(() => -1),
      (async () => {
        for await (const chunk of process.stdout) stdout += String(chunk);
      })(),
      (async () => {
        for await (const chunk of process.stderr) stderr += String(chunk);
      })(),
    ]);
    if (stdout.length > SQL_MAX_OUTPUT_BYTES) {
      throw new DatasetServiceError(DatasetErrors.codes.DATASET_QUERY_FAILED, 'SQL result is too large');
    }
    if (exitCode !== 0) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_QUERY_FAILED,
        `local SQL query failed: ${safeError(stderr || stdout)}`,
      );
    }
    try {
      const parsed = JSON.parse(stdout) as {
        columns?: unknown;
        rows?: unknown;
        truncated?: unknown;
      };
      if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) {
        throw new Error('invalid executor response');
      }
      return {
        columns: parsed.columns.filter((value): value is string => typeof value === 'string'),
        rows: parsed.rows.filter((value): value is unknown[] => Array.isArray(value)),
        truncated: parsed.truncated === true,
      };
    } catch (error) {
      throw new DatasetServiceError(
        DatasetErrors.codes.DATASET_QUERY_FAILED,
        `invalid SQL executor response: ${safeError(error)}`,
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

function makeSqliteScript(maxRows: number): string {
  return [
    'import base64, csv, io, json, os, re, sqlite3, sys',
    "query = base64.b64decode(os.environ['SPIDERBYTE_DATASET_QUERY']).decode('utf-8')",
    "if not re.match(r'^\\s*(select|with)\\b', query, re.I) or re.search(r';\\s*\\S', query): raise ValueError('read-only query required')",
    "raw = sys.stdin.read()",
    "if os.environ.get('SPIDERBYTE_DATASET_FORMAT') == 'jsonl':",
    "    records = []",
    "    for line_number, line in enumerate(raw.splitlines(), 1):",
    "        if not line.strip(): continue",
    "        value = json.loads(line)",
    "        if not isinstance(value, dict): raise ValueError(f'JSONL line {line_number} must contain an object')",
    "        records.append(value)",
    "    columns = list(dict.fromkeys(key for record in records for key in record.keys()))",
    "    rows = [[record.get(column) for column in columns] for record in records]",
    "else:",
    "    reader = csv.DictReader(io.StringIO(raw))",
    "    columns = reader.fieldnames or []",
    "    rows = [[record.get(column) for column in columns] for record in reader]",
    "ident = lambda value: '\"' + value.replace('\"', '\"\"') + '\"'",
    "db = sqlite3.connect(':memory:')",
    "db.execute('create table dataset (' + ','.join(ident(c) + ' NUMERIC' for c in columns) + ')')",
    "def convert(value):\n    if value is None or value == '': return None\n    if isinstance(value, bool): return 1 if value else 0\n    if isinstance(value, (int, float)): return value\n    if isinstance(value, (dict, list)): return json.dumps(value, separators=(',', ':'))\n    value = str(value)\n    if re.match(r'^[-+]?\\d+$', value): return int(value)\n    if re.match(r'^[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:e[-+]?\\d+)?$', value, re.I): return float(value)\n    if value.lower() in ('true', 'false'): return 1 if value.lower() == 'true' else 0\n    return value",
    "placeholders = ','.join('?' for _ in columns)",
    "for row in rows: db.execute('insert into dataset values (' + placeholders + ')', [convert(value) for value in row])",
    'cursor = db.execute(query)',
    'names = [d[0] for d in cursor.description or []]',
    `rows = cursor.fetchmany(${maxRows + 1})`,
    `print(json.dumps({'columns': names, 'rows': [list(row) for row in rows[:${maxRows}]], 'truncated': len(rows) > ${maxRows}}, separators=(',', ':')))`,
  ].join('\n');
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').slice(0, 500);
}

registerScopedService(
  LifecycleScope.Workspace,
  IWorkspaceDatasetService,
  WorkspaceDatasetService,
  ScopeActivation.OnDemand,
  'datasets',
);
