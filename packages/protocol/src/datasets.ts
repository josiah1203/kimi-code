import { z } from 'zod';

import { artifactIdSchema, platformIdentifierSchema, platformMetadataSchema, runIdSchema } from './platform';
import { workspaceIdSchema } from './workspace';
import { isoDateTimeSchema } from './time';

export const datasetFormatSchema = z.enum(['csv', 'jsonl']);
export type DatasetFormat = z.infer<typeof datasetFormatSchema>;

export const datasetColumnSchema = z.strictObject({
  name: z.string().min(1).max(500),
  type: z.enum(['integer', 'number', 'boolean', 'string', 'unknown']),
  nullable: z.boolean(),
  non_null_count: z.number().int().nonnegative(),
  distinct_count: z.number().int().nonnegative(),
});
export type DatasetColumn = z.infer<typeof datasetColumnSchema>;

export const datasetVersionSchema = z.strictObject({
  version: z.number().int().positive(),
  artifact_id: artifactIdSchema,
  row_count: z.number().int().nonnegative(),
  columns: z.array(datasetColumnSchema),
  created_at: isoDateTimeSchema,
  profile_artifact_ids: z.array(artifactIdSchema).optional(),
  metadata: platformMetadataSchema.optional(),
});
export type DatasetVersion = z.infer<typeof datasetVersionSchema>;

export const datasetSchema = z.strictObject({
  id: platformIdentifierSchema,
  workspace_id: workspaceIdSchema,
  name: z.string().min(1).max(500),
  format: datasetFormatSchema,
  source_path: z.string().min(1).optional(),
  current_version: z.number().int().positive(),
  versions: z.array(datasetVersionSchema).min(1),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  metadata: platformMetadataSchema.optional(),
});
export type Dataset = z.infer<typeof datasetSchema>;

export const datasetCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  name: z.string().min(1).max(500),
  format: datasetFormatSchema.default('csv'),
  source_path: z.string().min(1).optional(),
  content_base64: z.string().optional(),
  run_id: runIdSchema.optional(),
  policy_decision_id: platformIdentifierSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});
export type DatasetCreateInput = z.input<typeof datasetCreateInputSchema>;

export const datasetVersionCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  source_path: z.string().min(1).optional(),
  content_base64: z.string().optional(),
  run_id: runIdSchema.optional(),
  policy_decision_id: platformIdentifierSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});
export type DatasetVersionCreateInput = z.infer<typeof datasetVersionCreateInputSchema>;

export const datasetProfileSchema = z.strictObject({
  dataset_id: platformIdentifierSchema,
  version: z.number().int().positive(),
  row_count: z.number().int().nonnegative(),
  columns: z.array(datasetColumnSchema),
  artifact_id: artifactIdSchema,
  generated_at: isoDateTimeSchema,
});
export type DatasetProfile = z.infer<typeof datasetProfileSchema>;

export const datasetProfileInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
  version: z.number().int().positive().optional(),
  policy_decision_id: platformIdentifierSchema.optional(),
});
export type DatasetProfileInput = z.infer<typeof datasetProfileInputSchema>;

export const datasetQueryInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  sql: z.string().min(1).max(50_000),
  run_id: runIdSchema.optional(),
  version: z.number().int().positive().optional(),
  max_rows: z.number().int().positive().max(10_000).default(1_000),
  policy_decision_id: platformIdentifierSchema.optional(),
});
export type DatasetQueryInput = z.input<typeof datasetQueryInputSchema>;

export const datasetQueryResultSchema = z.strictObject({
  dataset_id: platformIdentifierSchema,
  version: z.number().int().positive(),
  columns: z.array(z.string().min(1)),
  rows: z.array(z.array(z.unknown())),
  row_count: z.number().int().nonnegative(),
  truncated: z.boolean(),
  artifact_id: artifactIdSchema,
  run_id: runIdSchema.optional(),
  policy_decision_id: platformIdentifierSchema.optional(),
});
export type DatasetQueryResult = z.infer<typeof datasetQueryResultSchema>;

/** Create an immutable dataset version from a read-only projection. */
export const datasetTransformInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  sql: z.string().min(1).max(50_000),
  run_id: runIdSchema.optional(),
  version: z.number().int().positive().optional(),
  max_rows: z.number().int().positive().max(500_000).default(500_000),
  policy_decision_id: platformIdentifierSchema.optional(),
  metadata: platformMetadataSchema.optional(),
});
export type DatasetTransformInput = z.input<typeof datasetTransformInputSchema>;
