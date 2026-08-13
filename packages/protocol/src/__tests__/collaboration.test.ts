/**
 * Collaboration WebSocket contract scenarios.
 *
 * The protocol schemas are the public boundary under test; no server or
 * persistence implementation is involved. Run with `pnpm --filter
 * @spiderbyte/protocol test`.
 */

import { describe, expect, it } from 'vitest';

import {
  collaborationMessageSchema,
  collaborationWsControlSchema,
  collaborationWsMessageSchema,
} from '../collaboration';

const workspaceId = 'wd_collaboration_012345abcdef';
const channelId = 'channel_general_012345';
const threadId = 'thread_general_012345';

describe('collaboration websocket contract', () => {
  it('parses a channel subscription with a replay cursor', () => {
    const control = collaborationWsControlSchema.parse({
      type: 'subscribe',
      request_id: 'request_collaboration_012345',
      workspace_id: workspaceId,
      channel_id: channelId,
      thread_id: threadId,
      after_sequence: 12,
      limit: 50,
    });

    expect(control).toMatchObject({
      type: 'subscribe',
      workspace_id: workspaceId,
      channel_id: channelId,
      after_sequence: 12,
    });
  });

  it('parses a durable collaboration message event', () => {
    const message = collaborationMessageSchema.parse({
      id: 'message_collaboration_012345',
      workspace_id: workspaceId,
      channel_id: channelId,
      thread_id: threadId,
      sequence: 1,
      event_sequence: 2,
      author_id: 'actor_collaboration_012345',
      author_kind: 'agent',
      author_display_name: 'Agent Core',
      content: 'execution completed',
      state: 'completed',
      artifact_ids: [],
      created_at: '2026-08-13T00:00:00.000Z',
      updated_at: '2026-08-13T00:00:00.000Z',
    });

    expect(collaborationWsMessageSchema.parse({ type: 'collaboration_message', message })).toMatchObject({
      type: 'collaboration_message',
      message: { sequence: 1, event_sequence: 2, state: 'completed' },
    });
  });

  it('rejects a collaboration message event with an invalid message state', () => {
    const message = {
      id: 'message_collaboration_012345',
      workspace_id: workspaceId,
      channel_id: channelId,
      thread_id: threadId,
      sequence: 1,
      author_id: 'actor_collaboration_012345',
      author_kind: 'agent',
      author_display_name: 'Agent Core',
      content: 'execution completed',
      state: 'unknown',
      artifact_ids: [],
      created_at: '2026-08-13T00:00:00.000Z',
      updated_at: '2026-08-13T00:00:00.000Z',
    };
    expect(() => collaborationWsMessageSchema.parse({
      type: 'collaboration_message',
      message,
    })).toThrow();
  });
});
