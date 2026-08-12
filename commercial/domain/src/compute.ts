import { z } from 'zod';

import {
  accountIdSchema,
  executionIdSchema,
  isoDateTimeSchema,
  organizationIdSchema,
  recordFieldsSchema,
  reservationIdSchema,
  workspaceIdSchema,
} from './common';

export const computeProviderStateSchema = z.enum(['configured', 'ready', 'degraded', 'disabled', 'unavailable']);
export const computeProviderSchema = z.strictObject({
  id: z.string().regex(/^compute_[A-Za-z0-9._:-]{2,127}$/),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema.optional(),
  name: z.string().trim().min(1).max(200),
  provider_type: z.enum(['local_test', 'customer_managed', 'kubernetes', 'batch', 'vm', 'external']),
  state: computeProviderStateSchema,
  supported_regions: z.array(z.string().min(1).max(100)).readonly(),
  capabilities: z.array(z.string().min(1).max(200)).readonly(),
  ...recordFieldsSchema.shape,
});
export type ComputeProvider = z.infer<typeof computeProviderSchema>;

export const computeRegionSchema = z.strictObject({
  id: z.string().regex(/^region_[A-Za-z0-9._:-]{2,127}$/),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema.optional(),
  provider_id: z.string().regex(/^compute_[A-Za-z0-9._:-]{2,127}$/),
  name: z.string().trim().min(1).max(100),
  state: z.enum(['available', 'degraded', 'unavailable']),
  residency: z.string().min(1).max(100),
  ...recordFieldsSchema.shape,
});
export type ComputeRegion = z.infer<typeof computeRegionSchema>;

export const jobClassSchema = z.strictObject({
  id: z.string().regex(/^jobclass_[A-Za-z0-9._:-]{2,127}$/),
  account_id: accountIdSchema,
  organization_id: organizationIdSchema.optional(),
  name: z.string().trim().min(1).max(100),
  cpu_millis: z.number().int().positive(),
  gpu_count: z.number().int().nonnegative(),
  memory_bytes: z.number().int().positive(),
  storage_bytes: z.number().int().nonnegative(),
  state: z.enum(['active', 'retired']),
  ...recordFieldsSchema.shape,
});
export type JobClass = z.infer<typeof jobClassSchema>;

export const reservationStateSchema = z.enum([
  'requested',
  'authorized',
  'budget_approved',
  'queued',
  'reserved',
  'starting',
  'running',
  'completing',
  'succeeded',
  'failed',
  'canceled',
  'timed_out',
  'reconciliation_required',
  'unavailable',
]);
export type ReservationState = z.infer<typeof reservationStateSchema>;

export const computeReservationSchema = z.strictObject({
  id: reservationIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema,
  provider_id: z.string().regex(/^compute_[A-Za-z0-9._:-]{2,127}$/),
  region_id: z.string().regex(/^region_[A-Za-z0-9._:-]{2,127}$/),
  job_class_id: z.string().regex(/^jobclass_[A-Za-z0-9._:-]{2,127}$/),
  run_id: z.string().min(1).max(256).optional(),
  attempt_id: z.string().min(1).max(256).optional(),
  usage_event_id: z.string().regex(/^usageevt_[A-Za-z0-9._:-]{2,127}$/).optional(),
  state: reservationStateSchema,
  requested_at: isoDateTimeSchema,
  lease_expires_at: isoDateTimeSchema.optional(),
  confirmed_at: isoDateTimeSchema.optional(),
  finished_at: isoDateTimeSchema.optional(),
  failure_code: z.string().min(1).max(200).optional(),
  ...recordFieldsSchema.shape,
});
export type ComputeReservation = z.infer<typeof computeReservationSchema>;

export const computeExecutionSchema = z.strictObject({
  id: executionIdSchema,
  reservation_id: reservationIdSchema,
  account_id: accountIdSchema,
  organization_id: organizationIdSchema,
  workspace_id: workspaceIdSchema,
  state: reservationStateSchema,
  worker_execution_ref: z.string().min(1).max(500).optional(),
  heartbeat_at: isoDateTimeSchema.optional(),
  started_at: isoDateTimeSchema.optional(),
  completed_at: isoDateTimeSchema.optional(),
  timeout_at: isoDateTimeSchema.optional(),
  retry_count: z.number().int().nonnegative(),
  failure_code: z.string().min(1).max(200).optional(),
  ...recordFieldsSchema.shape,
});
export type ComputeExecution = z.infer<typeof computeExecutionSchema>;
