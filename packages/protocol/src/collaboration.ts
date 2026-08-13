import { z } from 'zod';

import { artifactIdSchema, attemptIdSchema, platformIdentifierSchema, runIdSchema } from './platform';
import { isoDateTimeSchema } from './time';
import { workspaceIdSchema } from './workspace';

/**
 * Browser-facing collaboration projections.
 *
 * These records are deliberately separate from Agent Core transcripts and
 * runs. A collaboration message may link to a session/run/attempt, but the
 * linked platform record remains authoritative for execution and governance.
 */

export const collaborationChannelKindSchema = z.enum(['public', 'private', 'direct']);
export type CollaborationChannelKind = z.infer<typeof collaborationChannelKindSchema>;

export const collaborationChannelStateSchema = z.enum(['active', 'archived', 'locked']);
export type CollaborationChannelState = z.infer<typeof collaborationChannelStateSchema>;

export const collaborationChannelSchema = z.strictObject({
  id: platformIdentifierSchema,
  workspace_id: workspaceIdSchema,
  project_id: platformIdentifierSchema.optional(),
  kind: collaborationChannelKindSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500),
  state: collaborationChannelStateSchema,
  member_ids: z.array(platformIdentifierSchema),
  created_by: platformIdentifierSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  last_sequence: z.number().int().nonnegative(),
});
export type CollaborationChannel = z.infer<typeof collaborationChannelSchema>;

export const collaborationThreadStateSchema = z.enum(['active', 'archived', 'locked']);
export type CollaborationThreadState = z.infer<typeof collaborationThreadStateSchema>;

export const collaborationThreadSchema = z.strictObject({
  id: platformIdentifierSchema,
  workspace_id: workspaceIdSchema,
  channel_id: platformIdentifierSchema,
  title: z.string().min(1).max(200),
  state: collaborationThreadStateSchema,
  created_by: platformIdentifierSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  last_sequence: z.number().int().nonnegative(),
});
export type CollaborationThread = z.infer<typeof collaborationThreadSchema>;

export const collaborationMessageAuthorKindSchema = z.enum(['user', 'agent', 'system', 'tool']);
export type CollaborationMessageAuthorKind = z.infer<typeof collaborationMessageAuthorKindSchema>;

export const collaborationMessageStateSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
]);
export type CollaborationMessageState = z.infer<typeof collaborationMessageStateSchema>;

export const collaborationMessageSchema = z.strictObject({
  id: platformIdentifierSchema,
  workspace_id: workspaceIdSchema,
  channel_id: platformIdentifierSchema,
  thread_id: platformIdentifierSchema,
  /** Stable creation order within the collaboration stream. */
  sequence: z.number().int().positive(),
  /**
   * Monotonic collaboration event cursor. A projection update keeps
   * `sequence` stable and receives a new `event_sequence`, so reconnecting
   * clients can replay state changes without duplicating message identity.
   * Optional keeps persisted pre-revision projections readable; new writes
   * always include it.
   */
  event_sequence: z.number().int().positive().optional(),
  author_id: platformIdentifierSchema,
  author_kind: collaborationMessageAuthorKindSchema,
  author_display_name: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000),
  state: collaborationMessageStateSchema,
  client_message_id: platformIdentifierSchema.optional(),
  session_id: platformIdentifierSchema.optional(),
  run_id: runIdSchema.optional(),
  attempt_id: attemptIdSchema.optional(),
  artifact_ids: z.array(artifactIdSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});
export type CollaborationMessage = z.infer<typeof collaborationMessageSchema>;

export const collaborationChannelCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  kind: collaborationChannelKindSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  member_ids: z.array(platformIdentifierSchema).max(100).optional(),
});
export type CollaborationChannelCreateInput = z.infer<typeof collaborationChannelCreateInputSchema>;

export const collaborationThreadCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  title: z.string().min(1).max(200),
});
export type CollaborationThreadCreateInput = z.infer<typeof collaborationThreadCreateInputSchema>;

export const collaborationMessageCreateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  client_message_id: platformIdentifierSchema,
  thread_id: platformIdentifierSchema,
  content: z.string().min(1).max(20_000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CollaborationMessageCreateInput = z.infer<typeof collaborationMessageCreateInputSchema>;

/**
 * Server-side command input. The session is a platform resource, so the
 * command route validates that it belongs to the addressed workspace before
 * dispatching anything to Agent Core.
 */
export const collaborationMessageCommandInputSchema = collaborationMessageCreateInputSchema.extend({
  session_id: platformIdentifierSchema,
});
export type CollaborationMessageCommandInput = z.infer<typeof collaborationMessageCommandInputSchema>;

/** Server-side cancellation command for a message-linked Session/Run. */
export const collaborationMessageCancelInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  reason: z.string().max(2_000).optional(),
});
export type CollaborationMessageCancelInput = z.infer<typeof collaborationMessageCancelInputSchema>;

export const collaborationMessageUpdateInputSchema = z.strictObject({
  request_id: platformIdentifierSchema,
  state: collaborationMessageStateSchema.optional(),
  session_id: platformIdentifierSchema.optional(),
  run_id: runIdSchema.optional(),
  attempt_id: attemptIdSchema.optional(),
  artifact_ids: z.array(artifactIdSchema).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type CollaborationMessageUpdateInput = z.infer<typeof collaborationMessageUpdateInputSchema>;

export const collaborationCursorSchema = z.string().regex(/^\d+$/, 'collaboration cursors must be sequence numbers');

/** `after_sequence`/`next_cursor` address the message event cursor, not creation order. */
export const collaborationMessagePageSchema = z.strictObject({
  items: z.array(collaborationMessageSchema),
  next_cursor: collaborationCursorSchema.optional(),
});
export type CollaborationMessagePage = z.infer<typeof collaborationMessagePageSchema>;

export const collaborationMessageCommandResultSchema = z.strictObject({
  message: collaborationMessageSchema,
  session_id: platformIdentifierSchema,
  run_id: runIdSchema.optional(),
});
export type CollaborationMessageCommandResult = z.infer<typeof collaborationMessageCommandResultSchema>;

export const collaborationThreadPageSchema = z.strictObject({
  items: z.array(collaborationThreadSchema),
});
export type CollaborationThreadPage = z.infer<typeof collaborationThreadPageSchema>;

/** Durable collaboration WebSocket controls. */
export const collaborationWsControlSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('subscribe'),
    request_id: platformIdentifierSchema,
    workspace_id: workspaceIdSchema,
    channel_id: platformIdentifierSchema,
    thread_id: platformIdentifierSchema.optional(),
    after_sequence: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
  z.strictObject({
    type: z.literal('replay'),
    request_id: platformIdentifierSchema,
    after_sequence: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(100).optional(),
  }),
]);
export type CollaborationWsControl = z.infer<typeof collaborationWsControlSchema>;

export const collaborationWsAckSchema = z.strictObject({
  type: z.literal('ack'),
  request_id: platformIdentifierSchema,
  code: z.number().int(),
  msg: z.string(),
  data: collaborationMessagePageSchema.nullable(),
});
export type CollaborationWsAck = z.infer<typeof collaborationWsAckSchema>;

export const collaborationWsMessageSchema = z.strictObject({
  type: z.literal('collaboration_message'),
  message: collaborationMessageSchema,
});
export type CollaborationWsMessage = z.infer<typeof collaborationWsMessageSchema>;
